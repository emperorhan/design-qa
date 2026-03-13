import fs from "node:fs";
import path from "node:path";

import type { LoadedDesignQaConfig } from "./config";
import { validateIconDataset } from "./icons";
import { isFixtureEntry } from "./storybook";

export interface FigmaDatasetManifest {
  datasetVersion: 1;
  extractionMode: "native-mcp-remote" | "native-mcp-desktop" | "direct-mcp";
  generatedAt: string;
  fileKey?: string;
  fileName?: string;
  pageName?: string;
  mcpSource?: "remote" | "desktop" | "mixed" | "unknown";
  assetExportMode?: "local-export" | "remote-wrapper" | "mixed" | "unavailable";
  desktopAssetBaseUrl?: string;
  pageCollectionDepth?: "shallow" | "nested" | "full-canvas";
  svgNormalization?: "raw-only" | "partial" | "complete";
  registryMode?: "real" | "contains-placeholders";
  includedFiles: string[];
  nodeCoverage?: {
    totalRegistryNodes: number;
    coveredRegistryNodes: number;
    missingNodeIds: string[];
  };
  completeness: {
    context: boolean;
    nodes: boolean;
    tokens: boolean;
    components: boolean;
    icons: boolean;
  };
  warnings: string[];
}

export interface FigmaDatasetContext {
  fileKey?: string;
  fileName?: string;
  pageName?: string;
  pageId?: string;
  selectionCount?: number;
  nodeIds?: string[];
}

export interface FigmaDatasetNode {
  id: string;
  name: string;
  type: string;
  variantProperties?: Record<string, string>;
  children?: FigmaDatasetNode[];
}

export interface FigmaDatasetTokenGroup {
  color?: Array<{ name: string; value: string; role?: string }>;
  typography?: Array<{ name: string; value: string }>;
  spacing?: Array<{ name: string; value: number }>;
  radius?: Array<{ name: string; value: number }>;
  shadow?: Array<{ name: string; value: string }>;
  motion?: Array<{ name: string; value: string }>;
}

export interface FigmaDatasetComponent {
  id: string;
  name: string;
  storyKey?: string;
  variants?: string[];
  sourceNodeId?: string;
  codeConnect?: {
    sourcePath: string;
    exportName?: string;
  };
}

export interface LoadedFigmaDataset {
  rootDir: string;
  manifestPath: string;
  manifest: FigmaDatasetManifest | null;
  contextPath: string;
  nodesPath: string;
  tokensPath: string;
  componentsPath: string;
  iconsPath: string;
  screenshotsDir: string;
  codeConnectPath: string;
  constraintsPath: string;
  typographyRunsPath: string;
  context: FigmaDatasetContext | null;
  nodes: FigmaDatasetNode[];
  tokens: FigmaDatasetTokenGroup | null;
  components: FigmaDatasetComponent[];
  codeConnect: unknown;
  constraints: unknown;
  typographyRuns: unknown;
}

interface DatasetCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DatasetFixPlan {
  missingFiles: Array<{ file: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  missingNodeIds: Array<{ nodeId: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  missingTokenGroups: Array<{ group: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  missingComponents: Array<{ component: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  missingIcons: Array<{ icon: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  missingScreenshots: Array<{ storyKey: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
  manifestRepairs: Array<{ item: string; collectionItemId: string; recommendedAction: string; phase: "dataset" | "patch" }>;
}

export interface FigmaDatasetValidationReport {
  datasetRoot: string;
  manifestPath: string;
  hasManifest: boolean;
  extractionMode: string | null;
  sourceDetection: {
    mcpSource: "remote" | "desktop" | "mixed" | "unknown";
    assetExportMode: "local-export" | "remote-wrapper" | "mixed" | "unavailable";
    desktopAssetBaseUrl: string | null;
    pageCollectionDepth: "shallow" | "nested" | "full-canvas";
    svgNormalization: "raw-only" | "partial" | "complete";
    registryMode: "real" | "contains-placeholders";
    reasons: string[];
  };
  registryNodeCoverage: {
    total: number;
    covered: number;
    missing: string[];
  };
  files: {
    context: boolean;
    nodes: boolean;
    tokens: boolean;
    components: boolean;
    icons: boolean;
    codeConnect: boolean;
    constraints: boolean;
    typographyRuns: boolean;
    screenshotsDir: boolean;
  };
  manifestChecks: DatasetCheck[];
  fileChecks: DatasetCheck[];
  coverageChecks: DatasetCheck[];
  iconChecks: DatasetCheck[];
  screenshotChecks: DatasetCheck[];
  pageDepthChecks: DatasetCheck[];
  iconCompletenessChecks: DatasetCheck[];
  datasetIssues: string[];
  assetIssues: string[];
  mappingIssues: string[];
  placeholderFixtureIssues: string[];
  errors: string[];
  warnings: string[];
  fixPlan: DatasetFixPlan;
}

export function getFigmaDatasetRoot(cwd: string) {
  return path.join(cwd, ".design-qa", "figma");
}

export function loadFigmaDataset(cwd: string): LoadedFigmaDataset {
  const rootDir = getFigmaDatasetRoot(cwd);
  const manifestPath = path.join(rootDir, "manifest.json");
  const contextPath = path.join(rootDir, "context.json");
  const nodesPath = path.join(rootDir, "nodes.json");
  const tokensPath = path.join(rootDir, "tokens.json");
  const componentsPath = path.join(rootDir, "components.json");
  const iconsPath = path.join(rootDir, "icons.json");
  const screenshotsDir = path.join(rootDir, "screenshots");
  const codeConnectPath = path.join(rootDir, "code-connect.json");
  const constraintsPath = path.join(rootDir, "constraints.json");
  const typographyRunsPath = path.join(rootDir, "typography-runs.json");

  return {
    rootDir,
    manifestPath,
    manifest: readJson<FigmaDatasetManifest>(manifestPath),
    contextPath,
    nodesPath,
    tokensPath,
    componentsPath,
    iconsPath,
    screenshotsDir,
    codeConnectPath,
    constraintsPath,
    typographyRunsPath,
    context: readJson<FigmaDatasetContext>(contextPath),
    nodes: readJson<FigmaDatasetNode[]>(nodesPath) ?? [],
    tokens: readJson<FigmaDatasetTokenGroup>(tokensPath),
    components: readJson<FigmaDatasetComponent[]>(componentsPath) ?? [],
    codeConnect: readJson(codeConnectPath),
    constraints: readJson(constraintsPath),
    typographyRuns: readJson(typographyRunsPath),
  };
}

export function syncFigmaDatasetManifest(cwd: string, config: LoadedDesignQaConfig) {
  const dataset = loadFigmaDataset(cwd);
  if (!dataset.manifest || !config.validation.autoSyncManifest) {
    return { updated: false, manifestPath: dataset.manifestPath };
  }
  const actualFiles = collectIncludedFiles(dataset);
  const activeRegistryEntries = Object.values(config.registry).filter((entry) => !isFixtureEntry(entry));
  const registryNodes = activeRegistryEntries
    .map((entry) => entry.figmaNodeId)
    .filter((value): value is string => typeof value === "string" && !isLikelyPlaceholderNodeId(value));
  const flattenedNodeIds = new Set(flattenNodeIds(dataset.nodes));
  const actualCoverage = {
    totalRegistryNodes: registryNodes.length,
    coveredRegistryNodes: registryNodes.filter((nodeId) => flattenedNodeIds.has(nodeId)).length,
    missingNodeIds: registryNodes.filter((nodeId) => !flattenedNodeIds.has(nodeId)),
  };
  const sourceDetection = detectDatasetSource(dataset, cwd);
  const completeness = {
    context: fs.existsSync(dataset.contextPath) && Boolean(dataset.context),
    nodes: fs.existsSync(dataset.nodesPath) && dataset.nodes.length > 0,
    tokens: fs.existsSync(dataset.tokensPath) && Boolean(dataset.tokens),
    components: fs.existsSync(dataset.componentsPath) && dataset.components.length > 0,
    icons: fs.existsSync(dataset.iconsPath),
  };
  const nextManifest: FigmaDatasetManifest = {
    ...dataset.manifest,
    includedFiles: actualFiles,
    nodeCoverage: actualCoverage,
    completeness,
    mcpSource: sourceDetection.mcpSource,
    assetExportMode: sourceDetection.assetExportMode,
    desktopAssetBaseUrl: sourceDetection.desktopAssetBaseUrl ?? undefined,
    pageCollectionDepth: sourceDetection.pageCollectionDepth,
    svgNormalization: sourceDetection.svgNormalization,
    registryMode: activeRegistryEntries.some((entry) => entry.figmaNodeId && isLikelyPlaceholderNodeId(entry.figmaNodeId))
      ? "contains-placeholders"
      : "real",
  };
  const current = JSON.stringify(dataset.manifest);
  const next = JSON.stringify(nextManifest);
  if (current !== next) {
    fs.writeFileSync(dataset.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    return { updated: true, manifestPath: dataset.manifestPath };
  }
  return { updated: false, manifestPath: dataset.manifestPath };
}

export function validateFigmaDataset(cwd: string, config: LoadedDesignQaConfig) {
  const dataset = loadFigmaDataset(cwd);
  const errors: string[] = [];
  const warnings: string[] = [];
  const datasetIssues: string[] = [];
  const assetIssues: string[] = [];
  const mappingIssues: string[] = [];
  const placeholderFixtureIssues: string[] = [];
  const manifestChecks: DatasetCheck[] = [];
  const fileChecks: DatasetCheck[] = [];
  const coverageChecks: DatasetCheck[] = [];
  const iconChecks: DatasetCheck[] = [];
  const screenshotChecks: DatasetCheck[] = [];
  const pageDepthChecks: DatasetCheck[] = [];
  const iconCompletenessChecks: DatasetCheck[] = [];

  const actualFiles = collectIncludedFiles(dataset);
  const activeRegistryEntries = Object.values(config.registry).filter((entry) => !isFixtureEntry(entry));
  const registryNodes = activeRegistryEntries
    .map((entry) => entry.figmaNodeId)
    .filter((value): value is string => Boolean(value));
  const placeholderRegistryNodes = registryNodes.filter(isLikelyPlaceholderNodeId);
  const realRegistryNodes = registryNodes.filter((nodeId) => !isLikelyPlaceholderNodeId(nodeId));
  const flattenedNodeIds = new Set(flattenNodeIds(dataset.nodes));
  const actualCoverage = {
    total: realRegistryNodes.length,
    covered: realRegistryNodes.filter((nodeId) => flattenedNodeIds.has(nodeId)).length,
    missing: realRegistryNodes.filter((nodeId) => !flattenedNodeIds.has(nodeId)),
  };
  const sourceDetection = detectDatasetSource(dataset, cwd);
  sourceDetection.registryMode = placeholderRegistryNodes.length > 0 ? "contains-placeholders" : "real";
  const pageDepth = detectPageCollectionDepth(dataset.nodes);

  if (!fs.existsSync(dataset.rootDir)) {
    errors.push(".design-qa/figma directory is missing");
    return {
      dataset,
      errors,
      warnings,
      report: buildDatasetReport(
        dataset,
        errors,
        warnings,
        config,
        manifestChecks,
        fileChecks,
        coverageChecks,
        iconChecks,
        screenshotChecks,
        pageDepthChecks,
        iconCompletenessChecks,
        actualCoverage,
        sourceDetection,
        datasetIssues,
        assetIssues,
        mappingIssues,
        placeholderFixtureIssues,
      ),
    };
  }

  pushRequiredFileCheck(fileChecks, errors, "context.json", fs.existsSync(dataset.contextPath) && Boolean(dataset.context));
  pushRequiredFileCheck(fileChecks, errors, "nodes.json", fs.existsSync(dataset.nodesPath) && dataset.nodes.length > 0);
  pushRequiredFileCheck(fileChecks, errors, "tokens.json", fs.existsSync(dataset.tokensPath) && Boolean(dataset.tokens));
  pushRequiredFileCheck(fileChecks, errors, "components.json", fs.existsSync(dataset.componentsPath) && dataset.components.length > 0);

  if (!dataset.manifest) {
    errors.push("manifest.json is missing");
    manifestChecks.push({ name: "manifest.json", ok: false, detail: "manifest.json missing" });
  } else {
    const generatedAtOk = !Number.isNaN(Date.parse(dataset.manifest.generatedAt));
    const extractionModeOk = ["native-mcp-remote", "native-mcp-desktop", "direct-mcp"].includes(dataset.manifest.extractionMode);
    const datasetVersionOk = dataset.manifest.datasetVersion === 1;
    const includedFilesOk = sameStringSet(dataset.manifest.includedFiles, actualFiles);
    const completenessChecks = [
      { key: "context", actual: fs.existsSync(dataset.contextPath) && Boolean(dataset.context) },
      { key: "nodes", actual: fs.existsSync(dataset.nodesPath) && dataset.nodes.length > 0 },
      { key: "tokens", actual: fs.existsSync(dataset.tokensPath) && Boolean(dataset.tokens) },
      { key: "components", actual: fs.existsSync(dataset.componentsPath) && dataset.components.length > 0 },
      { key: "icons", actual: fs.existsSync(dataset.iconsPath) },
    ] as const;
    const completenessMismatches = completenessChecks
      .filter((item) => dataset.manifest!.completeness[item.key] !== item.actual)
      .map((item) => `${item.key}=${dataset.manifest!.completeness[item.key]} but actual=${item.actual}`);
    const nodeCoverageDeclared = dataset.manifest.nodeCoverage;
    const nodeCoverageOk =
      !nodeCoverageDeclared ||
      (nodeCoverageDeclared.totalRegistryNodes === actualCoverage.total &&
        nodeCoverageDeclared.coveredRegistryNodes === actualCoverage.covered &&
        sameStringSet(nodeCoverageDeclared.missingNodeIds, actualCoverage.missing));

    const manifestItems: Array<[string, boolean, string, "error" | "warning"]> = [
      ["datasetVersion", datasetVersionOk, datasetVersionOk ? "datasetVersion=1" : `expected 1, got ${dataset.manifest.datasetVersion}`, "error"],
      ["extractionMode", extractionModeOk, dataset.manifest.extractionMode, "error"],
      ["generatedAt", generatedAtOk, dataset.manifest.generatedAt, "error"],
      ["includedFiles", includedFilesOk, includedFilesOk ? "includedFiles match actual dataset files" : `declared=${dataset.manifest.includedFiles.join(", ")} actual=${actualFiles.join(", ")}`, "error"],
      ["completeness", completenessMismatches.length === 0, completenessMismatches.length === 0 ? "completeness flags match actual files" : completenessMismatches.join("; "), "error"],
      [
        "nodeCoverage",
        nodeCoverageOk || placeholderRegistryNodes.length > 0,
        nodeCoverageOk
          ? `${actualCoverage.covered}/${actualCoverage.total}`
          : placeholderRegistryNodes.length > 0
            ? "placeholder registry ids present; nodeCoverage treated as fixture mismatch"
            : "declared nodeCoverage does not match actual registry coverage",
        placeholderRegistryNodes.length > 0 ? "warning" : "error",
      ],
      [
        "mcpSource",
        !dataset.manifest.mcpSource || dataset.manifest.mcpSource === sourceDetection.mcpSource,
        !dataset.manifest.mcpSource ? `detected=${sourceDetection.mcpSource}` : `declared=${dataset.manifest.mcpSource} detected=${sourceDetection.mcpSource}`,
        "warning",
      ],
      [
        "assetExportMode",
        !dataset.manifest.assetExportMode || dataset.manifest.assetExportMode === sourceDetection.assetExportMode,
        !dataset.manifest.assetExportMode
          ? `detected=${sourceDetection.assetExportMode}`
          : `declared=${dataset.manifest.assetExportMode} detected=${sourceDetection.assetExportMode}`,
        "warning",
      ],
      [
        "pageCollectionDepth",
        !dataset.manifest.pageCollectionDepth || dataset.manifest.pageCollectionDepth === pageDepth.depth,
        !dataset.manifest.pageCollectionDepth ? `detected=${pageDepth.depth}` : `declared=${dataset.manifest.pageCollectionDepth} detected=${pageDepth.depth}`,
        "warning",
      ],
      [
        "registryMode",
        !dataset.manifest.registryMode || dataset.manifest.registryMode === (placeholderRegistryNodes.length > 0 ? "contains-placeholders" : "real"),
        !dataset.manifest.registryMode
          ? `detected=${placeholderRegistryNodes.length > 0 ? "contains-placeholders" : "real"}`
          : `declared=${dataset.manifest.registryMode}`,
        "warning",
      ],
    ];
    for (const [name, ok, detail, severity] of manifestItems) {
      manifestChecks.push({ name, ok, detail });
      if (!ok) {
        (severity === "error" ? errors : warnings).push(`manifest ${name} invalid: ${detail}`);
      }
    }
  }

  if (dataset.tokens) {
    const tokenChecks: Array<[string, boolean]> = [
      ["color", Boolean(dataset.tokens.color?.length)],
      ["typography", Boolean(dataset.tokens.typography?.length)],
      ["spacing", Boolean(dataset.tokens.spacing?.length)],
    ];
    for (const [group, ok] of tokenChecks) {
      const detail = ok ? `${group} tokens present` : `${group} tokens missing`;
      fileChecks.push({ name: `tokens.${group}`, ok, detail });
      if (!ok) warnings.push(`tokens.json has no ${group} tokens`);
    }
  }

  const unmappedComponents = activeRegistryEntries
    .filter((entry) => entry.figmaNodeId && !isLikelyPlaceholderNodeId(entry.figmaNodeId))
    .filter((entry) => {
      const byStoryKey = dataset.components.some((component) => component.storyKey === entry.key);
      const bySourceNode = dataset.components.some((component) => component.sourceNodeId === entry.figmaNodeId);
      return !byStoryKey && !bySourceNode;
    })
    .map((entry) => entry.key);
  if (unmappedComponents.length > 0) {
    const message = `components.json is missing mappings for: ${unmappedComponents.join(", ")}`;
    warnings.push(message);
    mappingIssues.push(message);
  }

  coverageChecks.push({
    name: "registryNodeCoverage",
    ok: actualCoverage.missing.length === 0,
    detail: `${actualCoverage.covered}/${actualCoverage.total} registry nodes covered`,
  });
  if (actualCoverage.missing.length > 0) {
    const message = `dataset is missing registry node ids: ${actualCoverage.missing.join(", ")}`;
    errors.push(message);
    datasetIssues.push(message);
  }
  if (placeholderRegistryNodes.length > 0) {
    const message = `registry contains placeholder fixture node ids: ${placeholderRegistryNodes.join(", ")}`;
    warnings.push(message);
    placeholderFixtureIssues.push(message);
    coverageChecks.push({
      name: "placeholderRegistryNodes",
      ok: false,
      detail: message,
    });
  }

  const iconValidation = validateIconDataset(cwd);
  if (fs.existsSync(dataset.iconsPath)) {
    iconChecks.push({
      name: "icons.json",
      ok: iconValidation.errors.length === 0,
      detail: `${iconValidation.icons.length} icons, ${iconValidation.errors.length} errors, ${iconValidation.warnings.length} warnings`,
    });
    errors.push(...iconValidation.errors.map((error) => `icons dataset: ${error}`));
    warnings.push(...iconValidation.warnings.map((warning) => `icons dataset: ${warning}`));
    assetIssues.push(...iconValidation.errors.map((error) => `icons dataset: ${error}`));
    for (const check of iconValidation.checks) {
      iconChecks.push({
        name: check.id,
        ok: check.errors.length === 0,
        detail:
          check.errors.length > 0
            ? check.errors.join("; ")
            : check.warnings.length > 0
              ? check.warnings.join("; ")
              : "icon artifacts valid",
      });
    }
  } else {
    iconChecks.push({
      name: "icons.json",
      ok: true,
      detail: "icons dataset absent (optional)",
    });
  }

  const screenshotFiles = listPngFiles(dataset.screenshotsDir);
  screenshotChecks.push({
    name: "screenshotsDir",
    ok: screenshotFiles.length > 0 || !actualFiles.some((file) => file.startsWith("screenshots/")),
    detail: screenshotFiles.length > 0 ? `${screenshotFiles.length} screenshots present` : "no screenshots present",
  });
  if (dataset.manifest?.includedFiles.some((file) => file.startsWith("screenshots/"))) {
    const missingDeclaredScreenshots = dataset.manifest.includedFiles
      .filter((file) => file.startsWith("screenshots/"))
      .filter((file) => !fs.existsSync(path.join(dataset.rootDir, file)));
    if (missingDeclaredScreenshots.length > 0) {
      screenshotChecks.push({
        name: "manifestScreenshots",
        ok: false,
        detail: `missing declared screenshots: ${missingDeclaredScreenshots.join(", ")}`,
      });
      const message = `manifest declared missing screenshots: ${missingDeclaredScreenshots.join(", ")}`;
      errors.push(message);
      assetIssues.push(message);
    }
  }
  for (const entry of Object.values(config.registry)) {
    if (isFixtureEntry(entry)) continue;
    if (!entry.figmaNodeId || isLikelyPlaceholderNodeId(entry.figmaNodeId)) continue;
    const screenshotFile = path.join(dataset.screenshotsDir, `${entry.figmaNodeId.replaceAll(":", "-")}.png`);
    const ok = fs.existsSync(screenshotFile);
    screenshotChecks.push({
      name: `story:${entry.key}`,
      ok,
      detail: ok ? path.relative(dataset.rootDir, screenshotFile) : `missing screenshot for ${entry.figmaNodeId}`,
    });
    if (!ok && config.validation.mode === "strict") {
      const message = `strict mode requires screenshot for ${entry.key}`;
      errors.push(message);
      assetIssues.push(message);
    }
  }

  pageDepthChecks.push({
    name: "pageCollectionDepth",
    ok: pageDepth.depth !== "shallow",
    detail: `depth=${pageDepth.depth}, topLevelFrames=${pageDepth.topLevelFrameCount}, nestedNodes=${pageDepth.nestedNodeCount}, capturedSubtrees=${pageDepth.capturedSubtreeCount}`,
  });
  if (pageDepth.depth === "shallow") {
    const message = "page stored as shallow tree only; nested node coverage is likely incomplete";
    warnings.push(message);
    datasetIssues.push(message);
  }

  const iconCompleteness = assessIconCompleteness(dataset.nodes, iconValidation.icons);
  for (const check of iconCompleteness.checks) {
    iconCompletenessChecks.push(check);
  }
  if (iconCompleteness.status === "likely-incomplete") {
    const message = `icons likely incomplete for page: ${iconCompleteness.missingCandidates.join(", ") || "missing page usage candidates"}`;
    warnings.push(message);
    datasetIssues.push(message);
  }

  if (sourceDetection.assetExportMode === "remote-wrapper") {
    const message = "remote MCP only; local asset export unavailable or wrapper SVG detected";
    errors.push(message);
    assetIssues.push(message);
  }
  if (sourceDetection.assetExportMode === "unavailable") {
    const message = "asset export unavailable";
    warnings.push(message);
    assetIssues.push(message);
  }

  const report = buildDatasetReport(
    dataset,
    unique(errors),
    unique(warnings),
    config,
    manifestChecks,
    fileChecks,
    coverageChecks,
    iconChecks,
    screenshotChecks,
    pageDepthChecks,
    iconCompletenessChecks,
    actualCoverage,
    sourceDetection,
    datasetIssues,
    assetIssues,
    mappingIssues,
    placeholderFixtureIssues,
  );
  return {
    dataset,
    errors: report.errors,
    warnings: report.warnings,
    report,
  };
}

export function renderDatasetFixPrompt(validation: ReturnType<typeof validateFigmaDataset>, cwd: string) {
  const { fixPlan } = validation.report;
  const lines = [
    "# Figma Dataset Repair Prompt",
    "",
    `Target repo: ${cwd}`,
    "",
    "Repair the Figma dataset in `.design-qa/figma` using native Figma MCP.",
    "Rewrite only the missing or inconsistent artifacts, then update manifest.json to match the actual dataset state.",
    "",
    "## Missing files",
    ...(fixPlan.missingFiles.length > 0 ? fixPlan.missingFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Missing registry node ids",
    ...(fixPlan.missingNodeIds.length > 0 ? fixPlan.missingNodeIds.map((id) => `- ${id}`) : ["- none"]),
    "",
    "## Missing token groups",
    ...(fixPlan.missingTokenGroups.length > 0 ? fixPlan.missingTokenGroups.map((group) => `- ${group}`) : ["- none"]),
    "",
    "## Missing components or variants",
    ...(fixPlan.missingComponents.length > 0 ? fixPlan.missingComponents.map((component) => `- ${component}`) : ["- none"]),
    "",
    "## Missing icon assets",
    ...(fixPlan.missingIcons.length > 0 ? fixPlan.missingIcons.map((icon) => `- ${icon}`) : ["- none"]),
    "",
    "## Missing screenshots",
    ...(fixPlan.missingScreenshots.length > 0 ? fixPlan.missingScreenshots.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Manifest repairs",
    ...(fixPlan.manifestRepairs.length > 0 ? fixPlan.manifestRepairs.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Repair rules",
    "- Prefer collection-plan.json item ids when re-collecting specific pages, components, or icons.",
    "- Use selection-based MCP for node ids and link-based MCP for canonical links/assets.",
    "- Remote MCP asset wrappers are not valid exports; prefer desktop MCP localhost asset export for SVG assets.",
    "- Keep icons background-transparent, currentColor-friendly, and do not rely on fixed root width/height.",
    "- Store raw icon exports separately from normalized SVG outputs.",
    "- Update manifest coverage, includedFiles, completeness, source fields, and warnings after the dataset is repaired.",
  ];
  return `${lines.join("\n")}\n`;
}

function buildDatasetReport(
  dataset: LoadedFigmaDataset,
  errors: string[],
  warnings: string[],
  config: LoadedDesignQaConfig,
  manifestChecks: DatasetCheck[],
  fileChecks: DatasetCheck[],
  coverageChecks: DatasetCheck[],
  iconChecks: DatasetCheck[],
  screenshotChecks: DatasetCheck[],
  pageDepthChecks: DatasetCheck[],
  iconCompletenessChecks: DatasetCheck[],
  actualCoverage: { total: number; covered: number; missing: string[] },
  sourceDetection: FigmaDatasetValidationReport["sourceDetection"],
  datasetIssues: string[],
  assetIssues: string[],
  mappingIssues: string[],
  placeholderFixtureIssues: string[],
): FigmaDatasetValidationReport {
  const fixPlan = buildDatasetFixPlan(dataset, config, manifestChecks, fileChecks, coverageChecks, iconChecks, screenshotChecks, actualCoverage);
  return {
    datasetRoot: dataset.rootDir,
    manifestPath: dataset.manifestPath,
    hasManifest: Boolean(dataset.manifest),
    extractionMode: dataset.manifest?.extractionMode ?? null,
    sourceDetection,
    registryNodeCoverage: actualCoverage,
    files: {
      context: fs.existsSync(dataset.contextPath) && Boolean(dataset.context),
      nodes: fs.existsSync(dataset.nodesPath) && dataset.nodes.length > 0,
      tokens: fs.existsSync(dataset.tokensPath) && Boolean(dataset.tokens),
      components: fs.existsSync(dataset.componentsPath) && dataset.components.length > 0,
      icons: fs.existsSync(dataset.iconsPath),
      codeConnect: Boolean(dataset.codeConnect),
      constraints: Boolean(dataset.constraints),
      typographyRuns: Boolean(dataset.typographyRuns),
      screenshotsDir: fs.existsSync(dataset.screenshotsDir),
    },
    manifestChecks,
    fileChecks,
    coverageChecks,
    iconChecks,
    screenshotChecks,
    pageDepthChecks,
    iconCompletenessChecks,
    datasetIssues: unique(datasetIssues),
    assetIssues: unique(assetIssues),
    mappingIssues: unique(mappingIssues),
    placeholderFixtureIssues: unique(placeholderFixtureIssues),
    errors,
    warnings,
    fixPlan,
  };
}

function buildDatasetFixPlan(
  dataset: LoadedFigmaDataset,
  config: LoadedDesignQaConfig,
  manifestChecks: DatasetCheck[],
  fileChecks: DatasetCheck[],
  _coverageChecks: DatasetCheck[],
  iconChecks: DatasetCheck[],
  screenshotChecks: DatasetCheck[],
  actualCoverage: { total: number; covered: number; missing: string[] },
): DatasetFixPlan {
  const missingTokenGroups = fileChecks
    .filter((check) => check.name.startsWith("tokens.") && !check.ok)
    .map((check) => ({
      group: check.name.replace("tokens.", ""),
      collectionItemId: `token:${check.name.replace("tokens.", "")}`,
      recommendedAction: `Re-collect the ${check.name.replace("tokens.", "")} token group and rewrite tokens.json.`,
      phase: "dataset" as const,
    }));
  const missingComponents = Object.values(config.registry)
    .filter((entry) => !entry.figmaNodeId || !isLikelyPlaceholderNodeId(entry.figmaNodeId))
    .filter((entry) => {
      const byStoryKey = dataset.components.some((component) => component.storyKey === entry.key);
      const bySourceNode = entry.figmaNodeId ? dataset.components.some((component) => component.sourceNodeId === entry.figmaNodeId) : false;
      return !byStoryKey && !bySourceNode;
    })
    .map((entry) => ({
      component: entry.key,
      collectionItemId: `page:${entry.key}`,
      recommendedAction: `Re-collect the page/component mapping for ${entry.key} and ensure components.json includes it.`,
      phase: "dataset" as const,
    }));
  const missingIcons = iconChecks
    .filter((check) => !check.ok && check.name !== "icons.json")
    .map((check) => ({
      icon: check.name,
      collectionItemId: `icon:${check.name}`,
      recommendedAction: `Re-export icon ${check.name} and rewrite icons.json plus the SVG asset.`,
      phase: "dataset" as const,
    }));
  const missingScreenshots = screenshotChecks
    .filter((check) => check.name.startsWith("story:") && !check.ok)
    .map((check) => ({
      storyKey: check.name.replace("story:", ""),
      collectionItemId: check.name,
      recommendedAction: `Capture the reference screenshot for ${check.name.replace("story:", "")} and write it to screenshots/<node-id>.png.`,
      phase: "dataset" as const,
    }));
  const manifestRepairs = manifestChecks
    .filter((check) => !check.ok)
    .map((check) => ({
      item: `${check.name}: ${check.detail}`,
      collectionItemId: "manifest",
      recommendedAction: `Rewrite manifest.json so ${check.name} matches the actual dataset state.`,
      phase: "dataset" as const,
    }));
  const missingFiles = fileChecks
    .filter((check) => !check.ok && !check.name.startsWith("tokens."))
    .map((check) => ({
      file: check.name,
      collectionItemId: collectionItemIdForFile(check.name),
      recommendedAction: recommendedActionForFile(check.name),
      phase: "dataset" as const,
    }));
  if (!dataset.manifest) {
    missingFiles.unshift({
      file: "manifest.json",
      collectionItemId: "manifest",
      recommendedAction: "Create manifest.json and populate includedFiles, completeness, and nodeCoverage from the collected dataset.",
      phase: "dataset",
    });
  }

  return {
    missingFiles: uniqueObjects(missingFiles, (item) => item.file),
    missingNodeIds: uniqueObjects(
      actualCoverage.missing.map((nodeId) => ({
        nodeId,
        collectionItemId: findCollectionItemIdForNode(config, nodeId),
        recommendedAction: `Re-collect node ${nodeId} with native Figma MCP and rewrite nodes.json.`,
        phase: "dataset" as const,
      })),
      (item) => item.nodeId,
    ),
    missingTokenGroups: uniqueObjects(missingTokenGroups, (item) => item.group),
    missingComponents: uniqueObjects(missingComponents, (item) => item.component),
    missingIcons: uniqueObjects(missingIcons, (item) => item.icon),
    missingScreenshots: uniqueObjects(missingScreenshots, (item) => item.storyKey),
    manifestRepairs: uniqueObjects(manifestRepairs, (item) => item.item),
  };
}

function pushRequiredFileCheck(checks: DatasetCheck[], errors: string[], name: string, ok: boolean) {
  checks.push({
    name,
    ok,
    detail: ok ? `${name} present` : `${name} missing or empty`,
  });
  if (!ok) {
    errors.push(`${name} is missing or empty`);
  }
}

function collectIncludedFiles(dataset: LoadedFigmaDataset) {
  const files: string[] = [];
  if (fs.existsSync(dataset.contextPath)) files.push("context.json");
  if (fs.existsSync(dataset.nodesPath)) files.push("nodes.json");
  if (fs.existsSync(dataset.tokensPath)) files.push("tokens.json");
  if (fs.existsSync(dataset.componentsPath)) files.push("components.json");
  if (fs.existsSync(dataset.iconsPath)) files.push("icons.json");
  if (fs.existsSync(dataset.codeConnectPath)) files.push("code-connect.json");
  if (fs.existsSync(dataset.constraintsPath)) files.push("constraints.json");
  if (fs.existsSync(dataset.typographyRunsPath)) files.push("typography-runs.json");
  if (fs.existsSync(dataset.screenshotsDir)) {
    for (const file of listPngFiles(dataset.screenshotsDir)) {
      files.push(`screenshots/${file}`);
    }
  }
  return files.sort();
}

function listPngFiles(dirPath: string) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .sort();
}

function flattenNodeIds(nodes: FigmaDatasetNode[]) {
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

function sameStringSet(left: string[], right: string[]) {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function uniqueObjects<T>(values: T[], getKey: (value: T) => string) {
  return values.filter((value, index) => values.findIndex((candidate) => getKey(candidate) === getKey(value)) === index);
}

function collectionItemIdForFile(fileName: string) {
  switch (fileName) {
    case "context.json":
    case "nodes.json":
      return "page:dataset-root";
    case "tokens.json":
      return "token:color";
    case "components.json":
      return "component:shared";
    default:
      return fileName === "manifest.json" ? "manifest" : fileName;
  }
}

function recommendedActionForFile(fileName: string) {
  switch (fileName) {
    case "context.json":
      return "Re-collect Figma file/page metadata and rewrite context.json.";
    case "nodes.json":
      return "Re-collect the target node tree and rewrite nodes.json.";
    case "tokens.json":
      return "Re-collect canonical token groups and rewrite tokens.json.";
    case "components.json":
      return "Re-collect shared components and variants and rewrite components.json.";
    case "manifest.json":
      return "Rewrite manifest.json so it matches the actual dataset state.";
    default:
      return `Rewrite ${fileName} from the latest Figma dataset export.`;
  }
}

function findCollectionItemIdForNode(config: LoadedDesignQaConfig, nodeId: string) {
  const entry = Object.values(config.registry).find((item) => item.figmaNodeId === nodeId);
  return entry ? `page:${entry.key}` : `node:${nodeId}`;
}

function detectDatasetSource(dataset: LoadedFigmaDataset, cwd: string): FigmaDatasetValidationReport["sourceDetection"] {
  const iconValidation = validateIconDataset(cwd);
  const refs = [
    ...iconValidation.checks.flatMap((check) => (check.originalRef ? [check.originalRef] : [])),
    ...dataset.manifest?.warnings ?? [],
  ];
  const hasRemote = refs.some((value) => value.includes("www.figma.com/api/mcp/asset/")) || dataset.manifest?.extractionMode === "native-mcp-remote";
  const desktopRef = refs.find((value) => value.includes("localhost:3845/assets/") || value.includes("127.0.0.1:3845/assets/")) ?? null;
  const hasDesktop = Boolean(desktopRef) || dataset.manifest?.extractionMode === "native-mcp-desktop";
  const hasRemoteWrapper = iconValidation.checks.some((check) => check.exportKind === "remote-wrapper-svg");
  const hasLocalExport = iconValidation.checks.some((check) => check.exportKind === "local-svg");
  const mcpSource = hasRemote && hasDesktop ? "mixed" : hasDesktop ? "desktop" : hasRemote ? "remote" : "unknown";
  const assetExportMode = hasRemoteWrapper && hasLocalExport ? "mixed" : hasLocalExport ? "local-export" : hasRemoteWrapper ? "remote-wrapper" : "unavailable";
  const reasons: string[] = [];
  if (hasRemoteWrapper) reasons.push("remote wrapper SVG detected");
  if (hasLocalExport) reasons.push("local SVG export detected");
  if (mcpSource === "desktop" || mcpSource === "mixed") reasons.push("desktop MCP localhost assets available");
  return {
    mcpSource,
    assetExportMode,
    desktopAssetBaseUrl: desktopRef ? extractBaseUrl(desktopRef) : dataset.manifest?.desktopAssetBaseUrl ?? null,
    pageCollectionDepth: detectPageCollectionDepth(dataset.nodes).depth,
    svgNormalization: detectSvgNormalization(iconValidation.checks),
    registryMode: hasLikelyPlaceholderRegistry(dataset.context) ? "contains-placeholders" : "real",
    reasons,
  };
}

function detectPageCollectionDepth(nodes: FigmaDatasetNode[]) {
  const topLevelFrameCount = nodes.length;
  const nestedNodeCount = countNodes(nodes) - topLevelFrameCount;
  const capturedSubtreeCount = nodes.filter((node) => Boolean(node.children?.length)).length;
  const depth = nestedNodeCount === 0 ? "shallow" : topLevelFrameCount >= 5 && nestedNodeCount >= topLevelFrameCount * 2 ? "full-canvas" : "nested";
  return {
    depth,
    topLevelFrameCount,
    nestedNodeCount,
    capturedSubtreeCount,
  } as const;
}

function assessIconCompleteness(nodes: FigmaDatasetNode[], icons: Array<{ name: string; nodeId?: string; usagePages?: string[]; usage?: string[] }>) {
  const iconLikeNodes = flattenNodes(nodes).filter((node) => isIconLikeNode(node));
  const iconNames = new Set(icons.map((icon) => icon.name.toLowerCase()));
  const missingCandidates = iconLikeNodes
    .filter((node) => {
      const normalizedName = node.name.toLowerCase();
      const exactOrPartialMatch = Array.from(iconNames).some((iconName) => normalizedName.includes(iconName) || iconName.includes(normalizedName));
      return !exactOrPartialMatch && /qr|scan|code/i.test(normalizedName);
    })
    .map((node) => node.name);
  const status = iconLikeNodes.length === 0 ? "unknown" : missingCandidates.length > 0 ? "likely-incomplete" : "complete";
  return {
    status,
    missingCandidates: unique(missingCandidates),
    checks: [
      {
        name: "iconUsageCoverage",
        ok: status !== "likely-incomplete",
        detail: `${icons.length} collected icons vs ${iconLikeNodes.length} icon-like nodes in page tree`,
      },
    ] as DatasetCheck[],
  };
}

function detectSvgNormalization(checks: Array<{ normalizationStatus: "raw" | "normalized" | "invalid" }>) {
  if (checks.length === 0) return "raw-only" as const;
  const normalizedCount = checks.filter((check) => check.normalizationStatus === "normalized").length;
  if (normalizedCount === checks.length) return "complete" as const;
  if (normalizedCount === 0) return "raw-only" as const;
  return "partial" as const;
}

function extractBaseUrl(value: string) {
  const match = value.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1] ?? value;
}

function hasLikelyPlaceholderRegistry(context: FigmaDatasetContext | null) {
  return Boolean(context?.nodeIds?.some(isLikelyPlaceholderNodeId));
}

function isLikelyPlaceholderNodeId(nodeId: string) {
  return /^123:\d+$/.test(nodeId);
}

function flattenNodes(nodes: FigmaDatasetNode[]) {
  const flattened: FigmaDatasetNode[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    flattened.push(node);
    if (node.children) stack.push(...node.children);
  }
  return flattened;
}

function countNodes(nodes: FigmaDatasetNode[]) {
  return flattenNodes(nodes).length;
}

function isIconLikeNode(node: FigmaDatasetNode) {
  return ["VECTOR", "BOOLEAN_OPERATION", "INSTANCE", "COMPONENT"].includes(node.type) && Boolean(node.name);
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}
