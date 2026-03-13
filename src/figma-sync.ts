import fs from "node:fs";
import path from "node:path";

import { fetchMcpDesignContext, fetchMcpMetadata } from "./mcp-bridge";
import { loadRuntimeConfig, relativeToCwd } from "./node";

interface FlattenedNode {
  id: string;
  name: string;
  type: string;
  depth: number;
  path: string;
  childCount: number;
}

const DEFAULT_CONTEXT_DEPTH = 12;
const DEFAULT_CONTEXT_TIMEOUT_MS = 20_000;
const MIN_CONTEXT_DEPTH = 2;

export async function syncFigmaPage(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const pagesDir = path.join(runtime.reportRoot, "figma-mcp", "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  const requestedPageName = getStringArg(args, "--page");
  const requestedDepth = getNumberArg(args, "--depth") ?? DEFAULT_CONTEXT_DEPTH;
  const timeoutMs = getNumberArg(args, "--timeout-ms") ?? DEFAULT_CONTEXT_TIMEOUT_MS;
  const metadata = await fetchMcpMetadata({ timeoutMs: Math.max(5_000, Math.floor(timeoutMs / 2)) });
  const { context, resolvedDepth, attempts } = await fetchDesignContextWithFallback({
    depth: requestedDepth,
    timeoutMs,
  });

  if (requestedPageName && context.currentPage.name !== requestedPageName) {
    throw new Error(
      `Current Figma page is "${context.currentPage.name}", expected "${requestedPageName}". Switch the active tab/page in Figma and retry.`,
    );
  }

  const flattened = flattenNodes(context.context);
  const slug = slugify(context.currentPage.name);
  const pagePath = path.join(pagesDir, `${slug}.json`);
  const nodeMapPath = path.join(pagesDir, `${slug}.nodes.json`);
  const suggestionsPath = path.join(runtime.reportRoot, "figma-mcp", "latest-mapping-suggestions.json");

  const pageSnapshot = {
    syncedAt: new Date().toISOString(),
    fileName: metadata.fileName,
    currentPage: context.currentPage,
    pageCount: metadata.pageCount,
    pages: metadata.pages,
    selectionCount: context.selectionCount,
    rootCount: context.context.length,
  };

  const suggestions = suggestMappings(runtime.config.registry, flattened);

  fs.writeFileSync(pagePath, JSON.stringify(pageSnapshot, null, 2));
  fs.writeFileSync(nodeMapPath, JSON.stringify(flattened, null, 2));
  fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2));

  const lines = [
    "# Figma Page Sync",
    "",
    `- File: ${metadata.fileName}`,
    `- Current page: ${context.currentPage.name} (${context.currentPage.id})`,
    `- Requested depth: ${requestedDepth}`,
    `- Resolved depth: ${resolvedDepth}`,
    `- Context timeout: ${timeoutMs}ms`,
    `- Nodes indexed: ${flattened.length}`,
    `- Snapshot: ${relativeToCwd(cwd, pagePath)}`,
    `- Node map: ${relativeToCwd(cwd, nodeMapPath)}`,
    `- Mapping suggestions: ${relativeToCwd(cwd, suggestionsPath)}`,
    "",
    "## Suggestions",
  ];

  for (const item of suggestions.slice(0, 20)) {
    lines.push(
      `- ${item.key}: ${item.status} -> ${item.suggestedNodeId ?? "none"} ${item.suggestedName ? `(${item.suggestedName})` : ""}`,
    );
  }

  if (attempts.length > 1) {
    lines.push("");
    lines.push("## Context Attempts");
    for (const attempt of attempts) {
      lines.push(`- depth ${attempt.depth}: ${attempt.outcome}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function fetchDesignContextWithFallback({
  depth,
  timeoutMs,
}: {
  depth: number;
  timeoutMs: number;
}) {
  const attempts: Array<{ depth: number; outcome: string }> = [];
  const fallbackDepths = buildFallbackDepths(depth);
  let lastError: unknown = null;

  for (const candidateDepth of fallbackDepths) {
    try {
      const context = await fetchMcpDesignContext({ depth: candidateDepth, timeoutMs });
      attempts.push({ depth: candidateDepth, outcome: "ok" });
      return { context, resolvedDepth: candidateDepth, attempts };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ depth: candidateDepth, outcome: message });
      if (!isRetryableContextError(message) || candidateDepth <= MIN_CONTEXT_DEPTH) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildFallbackDepths(requestedDepth: number) {
  const normalizedDepth = Math.max(MIN_CONTEXT_DEPTH, requestedDepth);
  const depths = new Set<number>([normalizedDepth]);
  let candidate = normalizedDepth;
  while (candidate > MIN_CONTEXT_DEPTH) {
    candidate = Math.max(MIN_CONTEXT_DEPTH, candidate - 2);
    depths.add(candidate);
    if (candidate === MIN_CONTEXT_DEPTH) {
      break;
    }
  }
  return [...depths];
}

function isRetryableContextError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("timed out");
}

function flattenNodes(nodes: Array<Record<string, unknown>>, depth = 0, parentPath = ""): FlattenedNode[] {
  const items: FlattenedNode[] = [];
  for (const node of nodes) {
    const id = String(node.id ?? "");
    const name = String(node.name ?? "");
    const type = String(node.type ?? "");
    const path = parentPath ? `${parentPath}/${name}` : name;
    const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : [];
    const childCount = Number(node.childCount ?? children.length ?? 0);
    items.push({ id, name, type, depth, path, childCount });
    if (children.length > 0) {
      items.push(...flattenNodes(children, depth + 1, path));
    }
  }
  return items;
}

function suggestMappings(
  registry: Record<string, { key: string; title: string; exportName: string; figmaNodeId?: string }>,
  nodes: FlattenedNode[],
) {
  return Object.values(registry).map((entry) => {
    const current = entry.figmaNodeId ? (nodes.find((node) => node.id === entry.figmaNodeId) ?? null) : null;
    if (current) {
      return {
        key: entry.key,
        status: "mapped",
        currentNodeId: entry.figmaNodeId,
        suggestedNodeId: current.id,
        suggestedName: current.name,
        suggestedPath: current.path,
      };
    }

    const candidates = buildStoryNameCandidates(entry);
    const match = nodes.find((node) => {
      const haystack = `${node.name} ${node.path}`.toLowerCase();
      return candidates.some((candidate) => haystack.includes(candidate));
    });

    return {
      key: entry.key,
      status: match ? "candidate" : "missing",
      currentNodeId: entry.figmaNodeId ?? null,
      suggestedNodeId: match?.id ?? null,
      suggestedName: match?.name ?? null,
      suggestedPath: match?.path ?? null,
      candidates,
    };
  });
}

function buildStoryNameCandidates(entry: { title: string; exportName: string; key: string }) {
  const title = entry.title.split("/").at(-1) ?? entry.title;
  const exportName = entry.exportName;
  return [
    title,
    exportName,
    `${title} ${exportName}`,
    title.replace(/Page$/, ""),
    exportName.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
    entry.key.split(".").at(-1) ?? entry.key,
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getStringArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function getNumberArg(args: string[], flag: string) {
  const raw = getStringArg(args, flag);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
