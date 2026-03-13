import fs from "node:fs";
import path from "node:path";

import { validateFigmaDataset, renderDatasetFixPrompt, syncFigmaDatasetManifest } from "./figma-dataset";
import { writeCollectionPlanArtifacts } from "./figma-collection";
import { normalizeIconDataset } from "./icons";
import { loadRuntimeConfig, relativeToCwd } from "./node";
import { runExportAgentTask } from "./agent-task";

export async function runValidateDataset(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const syncResult = syncFigmaDatasetManifest(cwd, runtime.config);
  if (runtime.config.validation.autoSyncCollectionPlan) {
    writeCollectionPlanArtifacts(cwd, runtime.config);
  }
  const validation = validateFigmaDataset(cwd, runtime.config);
  const jsonPath = path.join(runtime.reportRoot, "dataset-validation.json");
  const markdownPath = path.join(runtime.reportRoot, "dataset-validation.md");

  fs.mkdirSync(runtime.reportRoot, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(validation.report, null, 2));
  fs.writeFileSync(markdownPath, renderDatasetValidationMarkdown(validation.report, cwd));

  if (validation.errors.length > 0) {
    throw new Error(
      `Figma dataset validation failed. See ${relativeToCwd(cwd, jsonPath)} and ${relativeToCwd(cwd, markdownPath)}.`,
    );
  }

  return [
    "# Dataset Validation",
    "",
    `- JSON: ${relativeToCwd(cwd, jsonPath)}`,
    `- Markdown: ${relativeToCwd(cwd, markdownPath)}`,
    `- Errors: ${validation.errors.length}`,
    `- Warnings: ${validation.warnings.length}`,
    `- Manifest sync: ${syncResult.updated ? "updated" : "no changes"}`,
  ].join("\n") + "\n";
}

export async function runCollect(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const agent = getStringArg(args, "--agent") ?? "generic";
  const story = getStringArg(args, "--story");

  const { plan, planPath, markdownPath } = writeCollectionPlanArtifacts(cwd, runtime.config, story);
  const taskOutput = await runExportAgentTask(["figma-dataset", "--agent", agent, ...(story ? ["--story", story] : [])], cwd);
  const syncResult = syncFigmaDatasetManifest(cwd, runtime.config);
  const validation = validateFigmaDataset(cwd, runtime.config);

  const lines = [
    "# Design QA Collect",
    "",
    `- Collection plan: ${relativeToCwd(cwd, planPath)}`,
    `- Collection markdown: ${relativeToCwd(cwd, markdownPath)}`,
    `- Planned items: ${plan.length}`,
    `- Agent: ${agent}`,
    `- Manifest sync: ${syncResult.updated ? "updated" : "no changes"}`,
    `- Dataset errors: ${validation.errors.length}`,
    `- Dataset warnings: ${validation.warnings.length}`,
    `- MCP source: ${validation.report.sourceDetection.mcpSource}`,
    `- Asset export mode: ${validation.report.sourceDetection.assetExportMode}`,
    `- Page depth: ${validation.report.sourceDetection.pageCollectionDepth}`,
    "",
    "## Next Step",
    validation.errors.length === 0
      ? "- Dataset is ready enough to continue with `design-qa generate`."
      : "- Fill or repair `.design-qa/figma/*` with the generated agent task, then rerun `design-qa collect` or `design-qa validate-dataset`.",
    "",
    "## Agent Task",
    ...taskOutput.trim().split("\n"),
  ];
  return `${lines.join("\n")}\n`;
}

export async function runDatasetFix(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const validation = validateFigmaDataset(cwd, runtime.config);
  const promptPath = path.join(runtime.reportRoot, "dataset-fix-prompt.md");
  const jsonPath = path.join(runtime.reportRoot, "dataset-fix.json");

  fs.mkdirSync(runtime.reportRoot, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(validation.report.fixPlan, null, 2));
  fs.writeFileSync(promptPath, renderDatasetFixPrompt(validation, cwd));

  return [
    "# Dataset Fix",
    "",
    `- JSON: ${relativeToCwd(cwd, jsonPath)}`,
    `- Prompt: ${relativeToCwd(cwd, promptPath)}`,
    `- Errors: ${validation.errors.length}`,
    `- Warnings: ${validation.warnings.length}`,
  ].join("\n") + "\n";
}

export async function runDetectFigmaSource(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const validation = validateFigmaDataset(cwd, runtime.config);
  return [
    "# Figma Source Detection",
    "",
    `- MCP source: ${validation.report.sourceDetection.mcpSource}`,
    `- Asset export mode: ${validation.report.sourceDetection.assetExportMode}`,
    `- Desktop asset base URL: ${validation.report.sourceDetection.desktopAssetBaseUrl ?? "none"}`,
    `- Page collection depth: ${validation.report.sourceDetection.pageCollectionDepth}`,
    `- SVG normalization: ${validation.report.sourceDetection.svgNormalization}`,
    `- Registry mode: ${validation.report.sourceDetection.registryMode}`,
    `- Reasons: ${validation.report.sourceDetection.reasons.join(", ") || "none"}`,
  ].join("\n") + "\n";
}

export async function runInspectDataset(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const validation = validateFigmaDataset(cwd, runtime.config);
  return [
    "# Dataset Inspection",
    "",
    `- Dataset root: ${relativeToCwd(cwd, validation.report.datasetRoot)}`,
    `- MCP source: ${validation.report.sourceDetection.mcpSource}`,
    `- Asset export mode: ${validation.report.sourceDetection.assetExportMode}`,
    `- Page depth: ${validation.report.sourceDetection.pageCollectionDepth}`,
    `- SVG normalization: ${validation.report.sourceDetection.svgNormalization}`,
    `- Registry mode: ${validation.report.sourceDetection.registryMode}`,
    `- Dataset issues: ${validation.report.datasetIssues.length}`,
    `- Asset issues: ${validation.report.assetIssues.length}`,
    `- Mapping issues: ${validation.report.mappingIssues.length}`,
    `- Placeholder fixture issues: ${validation.report.placeholderFixtureIssues.length}`,
    "",
    "## Highlights",
    ...validation.report.datasetIssues.map((issue) => `- dataset: ${issue}`),
    ...validation.report.assetIssues.map((issue) => `- asset: ${issue}`),
    ...validation.report.mappingIssues.map((issue) => `- mapping: ${issue}`),
    ...validation.report.placeholderFixtureIssues.map((issue) => `- placeholder: ${issue}`),
  ].join("\n") + "\n";
}

export async function runNormalizeIcons(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const result = normalizeIconDataset(cwd, runtime.reportRoot);
  return [
    "# Normalize Icons",
    "",
    `- Dataset: ${relativeToCwd(cwd, result.datasetPath)}`,
    `- Normalized SVGs: ${relativeToCwd(cwd, result.normalizedDir)}`,
    `- Manifest: ${relativeToCwd(cwd, result.manifestPath)}`,
    `- Icons: ${result.icons.length}`,
  ].join("\n") + "\n";
}

function getStringArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function renderDatasetValidationMarkdown(report: ReturnType<typeof validateFigmaDataset>["report"], cwd: string) {
  const lines = [
    "# Figma Dataset Validation",
    "",
    `- Dataset root: ${relativeToCwd(cwd, report.datasetRoot)}`,
    `- Manifest: ${relativeToCwd(cwd, report.manifestPath)}`,
    `- Extraction mode: ${report.extractionMode ?? "unknown"}`,
    `- MCP source: ${report.sourceDetection.mcpSource}`,
    `- Asset export mode: ${report.sourceDetection.assetExportMode}`,
    `- Page depth: ${report.sourceDetection.pageCollectionDepth}`,
    `- SVG normalization: ${report.sourceDetection.svgNormalization}`,
    `- Registry mode: ${report.sourceDetection.registryMode}`,
    `- Registry coverage: ${report.registryNodeCoverage.covered}/${report.registryNodeCoverage.total}`,
    "",
    "## Source Detection",
  ];
  for (const reason of report.sourceDetection.reasons) {
    lines.push(`- ${reason}`);
  }
  if (report.sourceDetection.reasons.length === 0) {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## File Checks");
  for (const check of report.fileChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Manifest Checks");
  for (const check of report.manifestChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Coverage Checks");
  for (const check of report.coverageChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Icon Checks");
  for (const check of report.iconChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Screenshot Checks");
  for (const check of report.screenshotChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Page Depth Checks");
  for (const check of report.pageDepthChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Icon Completeness Checks");
  for (const check of report.iconCompletenessChecks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} (${check.detail})`);
  }
  lines.push("");
  lines.push("## Issue Categories");
  lines.push(`- datasetIssues: ${report.datasetIssues.join("; ") || "none"}`);
  lines.push(`- assetIssues: ${report.assetIssues.join("; ") || "none"}`);
  lines.push(`- mappingIssues: ${report.mappingIssues.join("; ") || "none"}`);
  lines.push(`- placeholderFixtureIssues: ${report.placeholderFixtureIssues.join("; ") || "none"}`);
  lines.push("");
  lines.push("## Errors");
  if (report.errors.length === 0) {
    lines.push("- none");
  } else {
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");
  lines.push("## Warnings");
  if (report.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  lines.push("## Fix Summary");
  lines.push(`- Missing files: ${report.fixPlan.missingFiles.map((item) => `${item.file} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Missing node ids: ${report.fixPlan.missingNodeIds.map((item) => `${item.nodeId} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Missing token groups: ${report.fixPlan.missingTokenGroups.map((item) => `${item.group} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Missing components: ${report.fixPlan.missingComponents.map((item) => `${item.component} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Missing icons: ${report.fixPlan.missingIcons.map((item) => `${item.icon} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Missing screenshots: ${report.fixPlan.missingScreenshots.map((item) => `${item.storyKey} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  lines.push(`- Manifest repairs: ${report.fixPlan.manifestRepairs.map((item) => `${item.item} -> ${item.collectionItemId}`).join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}
