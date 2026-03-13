import fs from "node:fs";
import path from "node:path";

import { validateFigmaDataset, renderDatasetFixPrompt } from "./figma-dataset";
import { loadRuntimeConfig, relativeToCwd } from "./node";

export async function runValidateDataset(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
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
  ].join("\n") + "\n";
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

function renderDatasetValidationMarkdown(report: ReturnType<typeof validateFigmaDataset>["report"], cwd: string) {
  const lines = [
    "# Figma Dataset Validation",
    "",
    `- Dataset root: ${relativeToCwd(cwd, report.datasetRoot)}`,
    `- Manifest: ${relativeToCwd(cwd, report.manifestPath)}`,
    `- Extraction mode: ${report.extractionMode ?? "unknown"}`,
    `- Registry coverage: ${report.registryNodeCoverage.covered}/${report.registryNodeCoverage.total}`,
    "",
    "## File Checks",
  ];
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
