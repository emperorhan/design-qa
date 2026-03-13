import fs from "node:fs";

import { loadFigmaDataset } from "./figma-dataset";
import { fetchMcpDesignContext, fetchMcpMetadata } from "./mcp-bridge";
import { analyzeScreenshot } from "./screenshot-analysis";
import {
  createSeedIr,
  mergeFigmaDatasetIntoIr,
  mergeFigmaIntoIr,
  readDesignIr,
  withScreenshotAnalysis,
  writeDesignIr,
  type DesignIR,
} from "./ir";
import { loadRuntimeConfig, relativeToCwd, resolveFromCwd } from "./node";
import type { DesignSourceType } from "./storybook";

export async function runIngest(args: string[], cwd = process.cwd()) {
  const [modeArg, ...rest] = args;
  const mode = normalizeMode(modeArg);
  const runtime = await loadRuntimeConfig(cwd);
  let ir = createSeedIr(runtime.config);

  if (mode === "figma") {
    ir = await hydrateWithFigma(ir, rest, cwd);
  } else if (mode === "screenshot") {
    ir = await hydrateWithScreenshot(ir, rest, cwd);
  } else {
    ir = await hydrateWithScreenshot(ir, rest, cwd);
    ir = await hydrateWithFigma(ir, rest, cwd);
  }

  writeDesignIr(runtime.irPath, ir);
  return [
    "# Design QA Ingest",
    "",
    `- Mode: ${ir.mode}`,
    `- IR: ${relativeToCwd(cwd, runtime.irPath)}`,
    `- Components: ${ir.components.length}`,
    `- Pages: ${ir.pages.length}`,
    `- Verification targets: ${ir.verificationTargets.length}`,
    `- Provenance records: ${ir.provenance.length}`,
    ...(ir.screenshotAnalysis
      ? [
          `- Screenshot palette: ${ir.screenshotAnalysis.dominantColors.join(", ")}`,
          `- Screenshot spacing candidates: ${ir.screenshotAnalysis.spacingCandidates.join(", ")}`,
        ]
      : []),
  ].join("\n") + "\n";
}

export async function loadExistingOrSeedIr(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  if (fs.existsSync(runtime.irPath)) {
    return { runtime, ir: readDesignIr(runtime.irPath) };
  }
  const ir = createSeedIr(runtime.config);
  writeDesignIr(runtime.irPath, ir);
  return { runtime, ir };
}

function normalizeMode(modeArg?: string): DesignSourceType {
  if (modeArg === "figma" || modeArg === "screenshot" || modeArg === "hybrid") {
    return modeArg;
  }
  throw new Error("Usage: design-qa ingest <figma|screenshot|hybrid> [...]");
}

async function hydrateWithFigma(ir: DesignIR, args: string[], cwd: string) {
  const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 8_000;
  const figmaTarget = getFigmaTarget(args);
  const dataset = loadFigmaDataset(cwd);
  if (dataset.manifest && dataset.context && dataset.nodes.length > 0) {
    const nodeIds = flattenDatasetNodeIds(dataset.nodes);
    const registryNodeIds = new Set(ir.provenance.flatMap((item) => item.nodeIds));
    const covered = [...registryNodeIds].filter((nodeId) => nodeIds.includes(nodeId)).length;
    return mergeFigmaDatasetIntoIr(ir, {
      extractionMode: dataset.manifest.extractionMode,
      includedFiles: dataset.manifest.includedFiles,
      coverage: {
        total: dataset.manifest.nodeCoverage?.totalRegistryNodes ?? registryNodeIds.size,
        covered: dataset.manifest.nodeCoverage?.coveredRegistryNodes ?? covered,
      },
      tokens: dataset.tokens,
      components: dataset.components,
      nodeIds,
      notes: [
        `Figma dataset manifest loaded from .design-qa/figma/manifest.json`,
        `Extraction mode: ${dataset.manifest.extractionMode}`,
        ...(figmaTarget ? [`Requested target: ${figmaTarget}`] : []),
      ],
    });
  }
  try {
    const [metadata, context] = await Promise.all([
      fetchMcpMetadata({ timeoutMs: Math.max(4_000, Math.floor(timeoutMs / 2)) }),
      fetchMcpDesignContext({ timeoutMs }),
    ]);
    const figmaNodeIds = context.context.map((node) => String(node.id ?? "")).filter(Boolean);
    const notes = [
      `Figma file: ${metadata.fileName}`,
      `Current page: ${context.currentPage.name}`,
      `Selection count: ${context.selectionCount}`,
      ...(figmaTarget ? [`Requested target: ${figmaTarget}`] : []),
    ];
    const nextIr = mergeFigmaIntoIr(ir, figmaNodeIds, notes);
    nextIr.pages = nextIr.pages.map((page) => ({
      ...page,
      breakpoints: page.breakpoints.length > 0 ? page.breakpoints : ["desktop", "tablet", "mobile"],
    }));
    return nextIr;
  } catch (error) {
    ir.provenance.unshift({
      source: "figma",
      fetchedAt: new Date().toISOString(),
      confidence: 0.1,
      nodeIds: [],
      notes: [`Figma MCP unavailable: ${error instanceof Error ? error.message : String(error)}`],
    });
    ir.verificationTargets.unshift({
      id: "figma:mcp-unavailable",
      type: "layout",
      label: "Figma ingest degraded",
      reason: "MCP bridge was unavailable, so the IR is running without structured Figma context.",
      severity: "high",
    });
    return ir;
  }
}

function flattenDatasetNodeIds(nodes: Array<{ id: string; children?: unknown[] }>) {
  const ids: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    ids.push(node.id);
    if (Array.isArray(node.children)) {
      stack.push(
        ...node.children.filter((child): child is { id: string; children?: unknown[] } => {
          return typeof child === "object" && child !== null && "id" in child;
        }),
      );
    }
  }
  return ids;
}

async function hydrateWithScreenshot(ir: DesignIR, args: string[], cwd: string) {
  const screenshotArg = getPositionalScreenshot(args) ?? getStringArg(args, "--screenshot");
  if (!screenshotArg) {
    throw new Error("Screenshot ingest requires a screenshot path. Use design-qa ingest screenshot <path> or --screenshot <path>.");
  }

  const screenshotPath = resolveFromCwd(cwd, screenshotArg);
  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot path not found: ${screenshotArg}`);
  }

  const stat = fs.statSync(screenshotPath);
  const analysis = await analyzeScreenshot(screenshotPath);
  const nextIr = withScreenshotAnalysis(ir, {
    ...analysis,
    path: screenshotArg,
  });

  nextIr.mode = nextIr.mode === "figma" ? "hybrid" : "screenshot";
  nextIr.provenance.unshift({
    source: nextIr.mode,
    fetchedAt: new Date().toISOString(),
    confidence: nextIr.mode === "hybrid" ? 0.75 : 0.45,
    nodeIds: [],
    screenshotPath: screenshotArg,
    fileHash: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
    notes: [
      "Screenshot bootstrap inferred palette, spacing, typography, radius, and block structure from a static artifact.",
      `Observed ${analysis.blockCount} major blocks and ${analysis.textBandCount} text bands.`,
    ],
  });
  nextIr.components = nextIr.components.map((component) => ({
    ...component,
    source: component.source === "figma" ? "hybrid" : "screenshot",
    confidence: component.source === "figma" ? 0.8 : 0.5,
    needsVerification: true,
  }));
  return nextIr;
}

function getPositionalScreenshot(args: string[]) {
  return args.find((arg) => !!arg && !arg.startsWith("--")) ?? null;
}

function getFigmaTarget(args: string[]) {
  return getStringArg(args, "--figma") ?? getPositionalValue(args);
}

function getPositionalValue(args: string[]) {
  return args.find((arg) => !!arg && !arg.startsWith("--")) ?? null;
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
