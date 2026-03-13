import fs from "node:fs";
import path from "node:path";

import type { LoadedDesignQaConfig } from "./config";
import { loadFigmaDataset, validateFigmaDataset } from "./figma-dataset";
import { validateIconDataset } from "./icons";
import { loadRuntimeConfig, relativeToCwd } from "./node";
import type { DesignQaEntry } from "./storybook";

type CollectionCategory = "token" | "asset" | "icon" | "component" | "page";
type CollectionMode = "selection" | "link";
type CollectionStatus = "pending" | "ready" | "partial" | "collected" | "invalid";

interface CollectionItem {
  id: string;
  collectionItemId: string;
  category: CollectionCategory;
  name: string;
  targetName: string;
  phase: "dataset" | "patch";
  storyKey?: string;
  figmaUrl?: string;
  nodeId?: string;
  collectionMode: CollectionMode;
  requiredArtifacts: string[];
  requiredFiles: string[];
  presentFiles: string[];
  validationErrors: string[];
  priority: "P0" | "P1" | "P2";
  status: CollectionStatus;
  lastCollectedAt?: string;
  recommendedAction: string;
  notes: string[];
}

const TOKEN_ITEMS = [
  {
    category: "asset" as const,
    name: "favicon",
    targetName: "Favicon",
    collectionMode: "link" as const,
    requiredArtifacts: ["svg-or-png", "background-guidance"],
    requiredFiles: ["assets/favicon.svg|png|ico", "assets/favicon.background.json"],
    priority: "P0" as const,
    notes: ["Collect the exact favicon asset or vector source used by the product shell."],
  },
  {
    category: "asset" as const,
    name: "og-image",
    targetName: "OG Image",
    collectionMode: "link" as const,
    requiredArtifacts: ["png", "layout-structure", "background-guidance"],
    requiredFiles: ["assets/og-image.png|jpg|jpeg", "assets/og-image.background.json"],
    priority: "P0" as const,
    notes: ["Capture Open Graph image composition and export at source resolution."],
  },
  {
    category: "token" as const,
    name: "typography",
    targetName: "Typography Tokens",
    collectionMode: "selection" as const,
    requiredArtifacts: ["tokens", "typography-runs"],
    requiredFiles: ["tokens.json", "typography-runs.json"],
    priority: "P0" as const,
    notes: ["Include display, heading, body, label scales and weights."],
  },
  {
    category: "token" as const,
    name: "color",
    targetName: "Color Tokens",
    collectionMode: "selection" as const,
    requiredArtifacts: ["tokens"],
    requiredFiles: ["tokens.json"],
    priority: "P0" as const,
    notes: ["Collect semantic surface, text, border, accent, feedback colors."],
  },
  {
    category: "token" as const,
    name: "spacing",
    targetName: "Spacing Tokens",
    collectionMode: "selection" as const,
    requiredArtifacts: ["tokens", "constraints"],
    requiredFiles: ["tokens.json", "constraints.json"],
    priority: "P0" as const,
    notes: ["Capture spacing scale and layout rhythm from canonical frames."],
  },
  {
    category: "token" as const,
    name: "evaluation-baseline",
    targetName: "Evaluation Baseline",
    collectionMode: "link" as const,
    requiredArtifacts: ["screenshots", "reference-links"],
    requiredFiles: ["screenshots/<node-id>.png"],
    priority: "P1" as const,
    notes: ["Reference frames used for visual QA and semantic review."],
  },
];

const COMMON_COMPONENTS = ["Header", "Footer", "StatusPanel", "Button", "RadioBox", "Input", "Card", "Modal", "Tabs", "Table"];

export async function runPrepareFigmaCollection(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const filter = getStringArg(args, "--story");
  const plan = buildCollectionPlan(Object.values(runtime.config.registry), cwd, filter, runtime.config);
  const planPath = path.join(cwd, ".design-qa", "figma", "collection-plan.json");
  const markdownPath = path.join(cwd, ".design-qa", "figma", "collection-plan.md");

  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  fs.writeFileSync(markdownPath, renderCollectionPlanMarkdown(plan));

  return [
    "# Figma Collection Plan",
    "",
    `- JSON: ${relativeToCwd(cwd, planPath)}`,
    `- Markdown: ${relativeToCwd(cwd, markdownPath)}`,
    `- Items: ${plan.length}`,
    `- Filter: ${filter ?? "none"}`,
  ].join("\n") + "\n";
}

function buildCollectionPlan(
  entries: DesignQaEntry[],
  cwd: string,
  filter: string | null | undefined,
  config: LoadedDesignQaConfig,
): CollectionItem[] {
  const filteredEntries = filter
    ? entries.filter((entry) => `${entry.key} ${entry.title} ${entry.exportName}`.toLowerCase().includes(filter.toLowerCase()))
    : entries;
  const dataset = loadFigmaDataset(cwd);
  const datasetValidation = validateFigmaDataset(cwd, config);
  const iconValidation = validateIconDataset(cwd);
  const items: CollectionItem[] = [];

  for (const token of TOKEN_ITEMS) {
    const state = buildTokenOrAssetStatus(token.name, dataset, datasetValidation, filteredEntries);
    items.push({
      id: `${token.category}:${token.name}`,
      collectionItemId: `${token.category}:${token.name}`,
      ...token,
      phase: "dataset",
      figmaUrl: undefined,
      nodeId: undefined,
      storyKey: undefined,
      recommendedAction: recommendedActionForCollection(`${token.category}:${token.name}`, state.status),
      ...state,
    });
  }

  for (const entry of filteredEntries) {
    const state = buildPageStatus(entry, dataset, datasetValidation);
    items.push({
      id: `page:${entry.key}`,
      collectionItemId: `page:${entry.key}`,
      category: "page",
      name: entry.key,
      targetName: `${entry.title}/${entry.exportName}`,
      phase: "dataset",
      storyKey: entry.key,
      figmaUrl: entry.figmaUrl,
      nodeId: entry.figmaNodeId,
      collectionMode: entry.figmaUrl ? "link" : "selection",
      requiredArtifacts: ["context", "nodes", "screenshot", "tokens", "components"],
      priority: "P0",
      recommendedAction: recommendedActionForCollection(`page:${entry.key}`, state.status),
      notes: ["Collect the canonical page/frame for this story key."],
      ...state,
    });
  }

  for (const componentName of COMMON_COMPONENTS) {
    const matchedEntry = filteredEntries.find((entry) => `${entry.title} ${entry.exportName}`.toLowerCase().includes(componentName.toLowerCase()));
    const state = buildComponentStatus(componentName, matchedEntry, dataset, datasetValidation);
    items.push({
      id: `component:${componentName.toLowerCase()}`,
      collectionItemId: `component:${componentName.toLowerCase()}`,
      category: "component",
      name: componentName,
      targetName: componentName,
      phase: "dataset",
      storyKey: matchedEntry?.key,
      figmaUrl: matchedEntry?.figmaUrl,
      nodeId: matchedEntry?.figmaNodeId,
      collectionMode: matchedEntry?.figmaUrl ? "link" : "selection",
      requiredArtifacts: ["components", "variants", "tokens", "constraints"],
      priority: componentName === "Header" || componentName === "Footer" || componentName === "Button" ? "P0" : "P1",
      recommendedAction: recommendedActionForCollection(`component:${componentName.toLowerCase()}`, state.status),
      notes: matchedEntry ? ["Mapped from existing registry entry."] : ["Provide a Figma link or selection for this shared component."],
      ...state,
    });
  }

  for (const iconCheck of iconValidation.checks) {
    const icon = iconValidation.icons.find((item) => item.id === iconCheck.id);
    const rawSvgPath = icon?.rawSvgPath ?? icon?.svgPath;
    const normalizedSvgPath = icon?.normalizedSvgPath;
    const presentFiles = [
      rawSvgPath && fs.existsSync(path.resolve(cwd, rawSvgPath)) ? toDatasetRelativePath(rawSvgPath) : null,
      normalizedSvgPath && fs.existsSync(path.resolve(cwd, normalizedSvgPath)) ? toDatasetRelativePath(normalizedSvgPath) : null,
    ].filter((value): value is string => Boolean(value));
    const status =
      iconCheck.errors.length > 0 || iconCheck.warnings.length > 0
        ? "invalid"
        : presentFiles.length > 0
          ? "collected"
          : icon?.nodeId
            ? "ready"
            : "pending";
    items.push({
      id: `icon:${iconCheck.id}`,
      collectionItemId: `icon:${iconCheck.id}`,
      category: "icon",
      name: icon?.name ?? iconCheck.id,
      targetName: icon?.name ?? iconCheck.id,
      phase: "dataset",
      storyKey: icon?.usage?.[0],
      figmaUrl: undefined,
      nodeId: icon?.nodeId,
      collectionMode: icon?.nodeId ? "selection" : "link",
      requiredArtifacts: ["svg", "icon-metadata"],
      requiredFiles: [toDatasetRelativePath(rawSvgPath ?? "icons/raw/<icon-id>.svg"), "icons.json"],
      presentFiles: ["icons.json", ...presentFiles].filter((value, index, list) => list.indexOf(value) === index),
      validationErrors: [...iconCheck.errors, ...iconCheck.warnings],
      priority: "P1",
      status,
      lastCollectedAt: latestMtimeIso(cwd, ["icons.json", ...presentFiles]),
      recommendedAction: recommendedActionForCollection(`icon:${iconCheck.id}`, status),
      notes: [
        ...(icon?.libraryCandidate ? [`Library candidate: ${icon.libraryCandidate}`] : []),
        `Export kind: ${iconCheck.exportKind}`,
        `Normalization status: ${iconCheck.normalizationStatus}`,
        "Ensure normalized SVG stays background-transparent and currentColor-driven.",
      ],
    });
  }

  return items;
}

function buildTokenOrAssetStatus(
  name: string,
  dataset: ReturnType<typeof loadFigmaDataset>,
  validation: ReturnType<typeof validateFigmaDataset>,
  entries: DesignQaEntry[],
) {
  const errors: string[] = [];
  const presentFiles: string[] = [];
  const requiredFiles: string[] = [];

  if (name === "typography") {
    requiredFiles.push("tokens.json", "typography-runs.json");
    if (dataset.tokens?.typography?.length) presentFiles.push("tokens.json");
    if (dataset.typographyRuns) presentFiles.push("typography-runs.json");
    if (!dataset.tokens?.typography?.length) errors.push("tokens.json missing typography tokens");
    if (!dataset.typographyRuns) errors.push("typography-runs.json missing");
  } else if (name === "color") {
    requiredFiles.push("tokens.json");
    if (dataset.tokens?.color?.length) presentFiles.push("tokens.json");
    if (!dataset.tokens?.color?.length) errors.push("tokens.json missing color tokens");
  } else if (name === "spacing") {
    requiredFiles.push("tokens.json", "constraints.json");
    if (dataset.tokens?.spacing?.length) presentFiles.push("tokens.json");
    if (dataset.constraints) presentFiles.push("constraints.json");
    if (!dataset.tokens?.spacing?.length) errors.push("tokens.json missing spacing tokens");
    if (!dataset.constraints) errors.push("constraints.json missing");
  } else if (name === "evaluation-baseline") {
    requiredFiles.push("screenshots/<node-id>.png");
    for (const entry of entries) {
      const file = screenshotPathForNode(entry.figmaNodeId);
      if (file && fs.existsSync(path.join(dataset.rootDir, file))) {
        presentFiles.push(file);
      }
    }
    if (presentFiles.length === 0) errors.push("no reference screenshots collected");
  } else if (name === "favicon" || name === "og-image") {
    const assetPaths = resolveAssetCandidatePaths(dataset.rootDir, name);
    requiredFiles.push(...assetPaths.required);
    presentFiles.push(...assetPaths.present);
    const bgGuidance = path.join(dataset.rootDir, "assets", `${name}.background.json`);
    if (!presentFiles.includes(`assets/${name}.background.json`) && fs.existsSync(bgGuidance)) {
      presentFiles.push(`assets/${name}.background.json`);
    }
    if (presentFiles.length === 0) errors.push(`${name} asset missing`);
  }

  const validationErrors = validation.report.fileChecks
    .filter((check) => !check.ok && requiredFiles.some((required) => check.name.includes(required.replace("|", ""))))
    .map((check) => check.detail);
  const allErrors = [...errors, ...validationErrors].filter((value, index, list) => list.indexOf(value) === index);
  const hasLocator = name === "favicon" || name === "og-image" ? false : entries.some((entry) => Boolean(entry.figmaNodeId || entry.figmaUrl));
  return {
    requiredFiles,
    presentFiles: unique(presentFiles),
    validationErrors: allErrors,
    status: deriveStatus(requiredFiles.length, presentFiles.length, hasLocator, allErrors.length > 0),
    lastCollectedAt: latestMtimeIso(dataset.rootDir, unique(presentFiles)),
  };
}

function buildPageStatus(entry: DesignQaEntry, dataset: ReturnType<typeof loadFigmaDataset>, validation: ReturnType<typeof validateFigmaDataset>) {
  const requiredFiles = ["context.json", "nodes.json", "tokens.json", "components.json"];
  const presentFiles = requiredFiles.filter((file) => fs.existsSync(path.join(dataset.rootDir, file)));
  const screenshotPath = screenshotPathForNode(entry.figmaNodeId);
  if (screenshotPath) {
    requiredFiles.push(screenshotPath);
    if (fs.existsSync(path.join(dataset.rootDir, screenshotPath))) presentFiles.push(screenshotPath);
  }
  const validationErrors = validation.report.screenshotChecks
    .filter((check) => check.name === `story:${entry.key}` && !check.ok)
    .map((check) => check.detail);
  const nodePresent = entry.figmaNodeId ? flattenNodeIds(dataset.nodes).includes(entry.figmaNodeId) : false;
  if (entry.figmaNodeId && !nodePresent) {
    validationErrors.push(`node ${entry.figmaNodeId} missing from nodes.json`);
  }
  if (validation.report.sourceDetection.pageCollectionDepth === "shallow") {
    validationErrors.push("page tree is shallow; recollect nested or full-canvas nodes");
  }
  return {
    requiredFiles,
    presentFiles: unique(presentFiles),
    validationErrors: unique(validationErrors),
    status: deriveStatus(requiredFiles.length, presentFiles.length, Boolean(entry.figmaNodeId || entry.figmaUrl), validationErrors.length > 0),
    lastCollectedAt: latestMtimeIso(dataset.rootDir, presentFiles),
  };
}

function buildComponentStatus(
  componentName: string,
  matchedEntry: DesignQaEntry | undefined,
  dataset: ReturnType<typeof loadFigmaDataset>,
  _validation: ReturnType<typeof validateFigmaDataset>,
) {
  const requiredFiles = ["components.json", "tokens.json", "constraints.json"];
  const presentFiles = requiredFiles.filter((file) => fs.existsSync(path.join(dataset.rootDir, file)));
  const componentExists = dataset.components.some(
    (component) =>
      component.name.toLowerCase() === componentName.toLowerCase() ||
      (matchedEntry?.key && component.storyKey === matchedEntry.key) ||
      (matchedEntry?.figmaNodeId && component.sourceNodeId === matchedEntry.figmaNodeId),
  );
  const validationErrors = componentExists ? [] : [`${componentName} missing from components.json`];
  return {
    requiredFiles,
    presentFiles,
    validationErrors,
    status: deriveStatus(requiredFiles.length + 1, presentFiles.length + (componentExists ? 1 : 0), Boolean(matchedEntry?.figmaNodeId || matchedEntry?.figmaUrl), validationErrors.length > 0),
    lastCollectedAt: latestMtimeIso(dataset.rootDir, presentFiles),
  };
}

function renderCollectionPlanMarkdown(plan: CollectionItem[]) {
  const lines = ["# Figma Collection Plan", ""];
  for (const item of plan) {
    lines.push(`## ${item.id}`);
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Target: ${item.targetName}`);
    lines.push(`- Phase: ${item.phase}`);
    lines.push(`- Story key: ${item.storyKey ?? "n/a"}`);
    lines.push(`- Collection mode: ${item.collectionMode}`);
    lines.push(`- Figma link: ${item.figmaUrl ?? "pending"}`);
    lines.push(`- Node id: ${item.nodeId ?? "pending"}`);
    lines.push(`- Required artifacts: ${item.requiredArtifacts.join(", ")}`);
    lines.push(`- Required files: ${item.requiredFiles.join(", ") || "none"}`);
    lines.push(`- Present files: ${item.presentFiles.join(", ") || "none"}`);
    lines.push(`- Priority: ${item.priority}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Last collected at: ${item.lastCollectedAt ?? "unknown"}`);
    lines.push(`- Recommended action: ${item.recommendedAction}`);
    if (item.validationErrors.length > 0) {
      for (const error of item.validationErrors) {
        lines.push(`- Validation error: ${error}`);
      }
    }
    for (const note of item.notes) {
      lines.push(`- Note: ${note}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function deriveStatus(requiredCount: number, presentCount: number, hasLocator: boolean, hasErrors: boolean): CollectionStatus {
  if (hasErrors) return presentCount > 0 ? "invalid" : hasLocator ? "ready" : "pending";
  if (presentCount === 0) return hasLocator ? "ready" : "pending";
  if (presentCount < requiredCount) return "partial";
  return "collected";
}

function resolveAssetCandidatePaths(rootDir: string, name: string) {
  const extensions = name === "favicon" ? ["svg", "png", "ico"] : ["png", "jpg", "jpeg"];
  const required = [`assets/${name}.${extensions.join("|")}`, `assets/${name}.background.json`];
  const present = extensions
    .map((ext) => `assets/${name}.${ext}`)
    .filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)));
  const bgGuidance = `assets/${name}.background.json`;
  if (fs.existsSync(path.join(rootDir, bgGuidance))) {
    present.push(bgGuidance);
  }
  return { required, present };
}

function screenshotPathForNode(nodeId?: string) {
  return nodeId ? `screenshots/${nodeId.replaceAll(":", "-")}.png` : "";
}

function latestMtimeIso(rootDir: string, files: string[]) {
  const mtimes = files
    .filter(Boolean)
    .map((file) => path.join(rootDir, file))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtimeMs);
  if (mtimes.length === 0) return undefined;
  return new Date(Math.max(...mtimes)).toISOString();
}

function flattenNodeIds(nodes: ReturnType<typeof loadFigmaDataset>["nodes"]) {
  const ids: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    ids.push(node.id);
    if (node.children) {
      stack.push(...node.children);
    }
  }
  return ids;
}

function normalizeRepoPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function toDatasetRelativePath(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  const prefix = ".design-qa/figma/";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function unique(values: string[]) {
  return values.filter((value, index, list) => list.indexOf(value) === index);
}

function getStringArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function recommendedActionForCollection(collectionItemId: string, status: CollectionStatus) {
  if (status === "collected") {
    return `No action. ${collectionItemId} is complete.`;
  }
  if (status === "partial") {
    return `Complete the missing artifacts for ${collectionItemId} and rerun design-qa validate-dataset.`;
  }
  if (status === "invalid") {
    return `Repair the invalid artifacts for ${collectionItemId} and rerun design-qa validate-dataset.`;
  }
  if (status === "ready") {
    return `Collect the required Figma artifacts for ${collectionItemId} now.`;
  }
  return `Provide the missing Figma link or selection for ${collectionItemId}, then collect its artifacts.`;
}
