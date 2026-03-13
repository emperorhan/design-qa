import fs from "node:fs";
import path from "node:path";

import type { EvaluationReport } from "./eval";
import { loadRuntimeConfig, relativeToCwd } from "./node";

export async function runFix(_args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  if (!fs.existsSync(runtime.evalReportPath)) {
    throw new Error("No eval report found. Run design-qa eval first.");
  }

  const report = JSON.parse(fs.readFileSync(runtime.evalReportPath, "utf-8")) as EvaluationReport;
  const failingStories = report.stories.filter((story) => !story.passed);
  const prompt = renderFixPrompt(report, failingStories);
  fs.mkdirSync(path.dirname(runtime.fixPromptPath), { recursive: true });
  fs.writeFileSync(runtime.fixPromptPath, prompt);

  return [
    "# Design QA Fix",
    "",
    `- Prompt: ${relativeToCwd(cwd, runtime.fixPromptPath)}`,
    `- Failing stories: ${failingStories.length}`,
  ].join("\n") + "\n";
}

function renderFixPrompt(report: EvaluationReport, failingStories: EvaluationReport["stories"]) {
  const lines = [
    "# Design QA Fix Prompt",
    "",
    `Generated at: ${report.generatedAt}`,
    `Threshold: ${report.threshold}`,
    `Semantic status: ${report.semanticStatus}`,
    "",
    "Apply focused patches to the failing stories below. Preserve tokenization, variant structure, and Storybook-first flow.",
    "Separate fixes into visual fidelity, component architecture quality, and token consistency.",
    "",
  ];

  for (const story of failingStories) {
    lines.push(`## ${story.entryKey}`);
    lines.push(`- Visual fidelity score: ${story.visual.score}`);
    lines.push(`- Pixel diff ratio: ${story.visual.pixelDiffRatio ?? "n/a"}`);
    lines.push(`- Dimension mismatch: ${story.visual.dimensionMismatch}`);
    lines.push("- Deterministic checks:");
    for (const check of story.deterministic.checks) {
      lines.push(`  - ${check}`);
    }
    lines.push("- Semantic findings:");
    for (const finding of story.semantic) {
      lines.push(`  - ${finding.severity.toUpperCase()} ${finding.category}: ${finding.finding}`);
      lines.push(`  - Suggested fix: ${finding.suggestedFix}`);
    }
    lines.push("");
  }

  if (failingStories.length === 0) {
    lines.push("All stories are passing. No fix prompt required.");
  }

  return `${lines.join("\n")}\n`;
}
