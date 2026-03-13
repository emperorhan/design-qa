import fs from "node:fs";
import path from "node:path";

import type { LoadedDesignQaConfig } from "./config";
import { readDesignIr } from "./ir";
import { loadRuntimeConfig, relativeToCwd } from "./node";
import { runDesignLoop } from "./loop";

interface LoopSummary {
  storybookUrl: string;
  runDir: string;
  threshold: number;
  totalStories: number;
  passedStories: string[];
  failedStories: string[];
  stories: Array<{
    entryKey: string;
    title: string;
    exportName: string;
    figmaNodeId?: string;
    iframeUrl: string;
    passed: boolean;
    finalScore: number;
    iterations: Array<{
      iteration: number;
      score: number;
      passed: boolean;
      criticalViolations: string[];
      metrics: {
        overflowCount: number;
        dimensionMismatch: number;
        pixelDiffRatio: number | null;
        screenshotPath: string;
        diffPath?: string;
        referencePath?: string;
      };
    }>;
  }>;
}

export interface SemanticEvalFinding {
  storyKey: string;
  severity: "low" | "medium" | "high";
  category: "layout" | "tokens" | "architecture" | "iconography" | "responsive";
  finding: string;
  suggestedFix: string;
  confidence: number;
}

export interface EvaluationReport {
  generatedAt: string;
  storybookUrl: string;
  threshold: number;
  visualFidelity: number;
  componentArchitectureQuality: number;
  tokenConsistency: number;
  semanticStatus: "pending" | "complete" | "disabled";
  semanticArtifacts?: {
    promptPath: string;
    inputPath: string;
    outputPath: string;
  };
  stories: Array<{
    entryKey: string;
    passed: boolean;
    deterministic: {
      passed: boolean;
      checks: string[];
    };
    visual: {
      score: number;
      pixelDiffRatio: number | null;
      dimensionMismatch: number;
      passed: boolean;
    };
    semantic: SemanticEvalFinding[];
    semanticCategories: string[];
    finalScore: number;
  }>;
}

export async function runEval(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const reportOnly = args.includes("--report-only");

  if (!reportOnly) {
    await runDesignLoop(args, cwd);
  }

  const summaryPath = path.join(runtime.reportRoot, "latest-summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(
      reportOnly
        ? "No design QA summary found for --report-only. Run `design-qa eval` first so it can render stories, collect screenshots, and write .design-qa/latest-summary.json."
        : "No design QA summary found. Run `design-qa eval` or `design-qa loop` first.",
    );
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as LoopSummary;
  const ir = fs.existsSync(runtime.irPath) ? readDesignIr(runtime.irPath) : null;
  const semanticInput = buildSemanticEvalInput(summary, ir);
  const semanticEnabled = runtime.config.evaluation.semantic.enabled;
  const semanticOutput = semanticEnabled ? readSemanticOutput(runtime.semanticEvalOutputPath) : null;

  fs.mkdirSync(path.dirname(runtime.semanticEvalInputPath), { recursive: true });
  if (semanticEnabled) {
    fs.writeFileSync(runtime.semanticEvalInputPath, JSON.stringify(semanticInput, null, 2));
    fs.writeFileSync(runtime.semanticEvalPromptPath, renderSemanticEvalPrompt(semanticInput));
  }

  const report = buildEvaluationReport(summary, {
    semanticEnabled,
    semanticOutput,
    semanticPromptPath: runtime.semanticEvalPromptPath,
    semanticInputPath: runtime.semanticEvalInputPath,
    semanticOutputPath: runtime.semanticEvalOutputPath,
  });
  fs.mkdirSync(path.dirname(runtime.evalReportPath), { recursive: true });
  fs.writeFileSync(runtime.evalReportPath, JSON.stringify(report, null, 2));
  const patchPlan = buildPatchPlan(summary, report, runtime.config, ir, cwd, runtime.evalReportPath, runtime.semanticEvalInputPath, runtime.semanticEvalOutputPath);
  fs.writeFileSync(runtime.patchPlanPath, JSON.stringify(patchPlan, null, 2));
  fs.writeFileSync(runtime.patchPromptPath, renderPatchPrompt(patchPlan));

  return renderEvaluationReport(report, relativeToCwd(cwd, runtime.evalReportPath));
}

export function buildEvaluationReport(
  summary: LoopSummary,
  options: {
    semanticEnabled: boolean;
    semanticOutput: SemanticEvalFinding[] | null;
    semanticPromptPath: string;
    semanticInputPath: string;
    semanticOutputPath: string;
  },
): EvaluationReport {
  const semanticByStory = new Map<string, SemanticEvalFinding[]>();
  for (const finding of options.semanticOutput ?? []) {
    const list = semanticByStory.get(finding.storyKey) ?? [];
    list.push(finding);
    semanticByStory.set(finding.storyKey, list);
  }

  const stories = summary.stories.map((story) => {
    const finalIteration = story.iterations.at(-1)!;
    const deterministic = {
      passed: finalIteration.criticalViolations.length === 0 && finalIteration.metrics.overflowCount === 0,
      checks: [
        finalIteration.criticalViolations.length === 0 ? "storybook render succeeded" : "critical render violations present",
        finalIteration.metrics.overflowCount === 0 ? "no overflow detected" : `${finalIteration.metrics.overflowCount} overflow candidates detected`,
        finalIteration.metrics.screenshotPath ? "screenshot capture succeeded" : "screenshot capture missing",
      ],
    };
    const visual = {
      score: finalIteration.score,
      pixelDiffRatio: finalIteration.metrics.pixelDiffRatio,
      dimensionMismatch: finalIteration.metrics.dimensionMismatch,
      passed: finalIteration.passed,
    };
    const semantic = options.semanticEnabled
      ? semanticByStory.get(story.entryKey) ?? inferSemanticFindings(story.entryKey, story.title, story.exportName, finalIteration)
      : [];

    return {
      entryKey: story.entryKey,
      passed: deterministic.passed && visual.passed && semantic.every((item) => item.severity !== "high"),
      deterministic,
      visual,
      semantic,
      semanticCategories: unique(semantic.map((item) => item.category)),
      finalScore: story.finalScore,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    storybookUrl: summary.storybookUrl,
    threshold: summary.threshold,
    visualFidelity: average(stories.map((story) => story.visual.score)),
    componentArchitectureQuality: average(
      stories.map((story) => (story.semantic.some((item) => item.category === "architecture") ? 70 : 92)),
    ),
    tokenConsistency: average(stories.map((story) => (story.semantic.some((item) => item.category === "tokens") ? 68 : 90))),
    semanticStatus: options.semanticEnabled ? (options.semanticOutput ? "complete" : "pending") : "disabled",
    semanticArtifacts: options.semanticEnabled
      ? {
          promptPath: options.semanticPromptPath,
          inputPath: options.semanticInputPath,
          outputPath: options.semanticOutputPath,
        }
      : undefined,
    stories,
  };
}

function buildSemanticEvalInput(summary: LoopSummary, ir: ReturnType<typeof readDesignIr> | null) {
  return {
    generatedAt: new Date().toISOString(),
    instructions: [
      "Review each story against its visual metrics and IR verification targets.",
      "Focus on visual fidelity, component architecture quality, and token consistency.",
      "Use iconography for icon choice, stroke/fill, alignment, and background-conflict issues.",
      "Use responsive for breakpoint, fold placement, and viewport-specific behavior.",
      "Return JSON only using the expected SemanticEvalFinding[] schema.",
    ],
    rubric: {
      categories: {
        layout: "Hierarchy, spacing rhythm, alignment, and general layout structure.",
        tokens: "Typography, color, radius, shadow, and token assignment issues.",
        architecture: "Componentization, overflow, truncation, reuse, and state structure.",
        iconography: "Wrong icon choice, vector styling mismatch, icon background conflict, or icon alignment issues.",
        responsive: "Breakpoint intent, fold placement, truncation, and viewport-specific behavior.",
      },
      severity: {
        high: "Pass blocking. The implementation should not be accepted until fixed.",
        medium: "Patch required. The story is usable but materially incorrect.",
        low: "Advisory. Minor issue or no patch required.",
      },
      guardrails: [
        "Do not recommend editing generated artifacts unless they are the explicit source of truth.",
        "Do not infer token-file edits unless patch-plan.json points to a token source file.",
        "Do not classify icon problems as token problems when the issue is icon choice or vector styling.",
      ],
    },
    ir: ir
      ? {
          mode: ir.mode,
          verificationTargets: ir.verificationTargets,
          semanticRoles: ir.semanticRoles,
        }
      : null,
    stories: summary.stories.map((story) => {
      const finalIteration = story.iterations.at(-1)!;
      return {
        storyKey: story.entryKey,
        title: story.title,
        exportName: story.exportName,
        finalScore: story.finalScore,
        criticalViolations: finalIteration.criticalViolations,
        metrics: finalIteration.metrics,
        referenceArtifacts: [finalIteration.metrics.referencePath, finalIteration.metrics.screenshotPath, finalIteration.metrics.diffPath].filter(
          (value): value is string => Boolean(value),
        ),
      };
    }),
    schema: {
      storyKey: "string",
      severity: '"low" | "medium" | "high"',
      category: '"layout" | "tokens" | "architecture" | "iconography" | "responsive"',
      finding: "string",
      suggestedFix: "string",
      confidence: "number 0..1",
    },
  };
}

function renderSemanticEvalPrompt(input: ReturnType<typeof buildSemanticEvalInput>) {
  return [
    "# Semantic Design QA Evaluator",
    "",
    "Use the JSON input file alongside the latest visual metrics to produce semantic findings.",
    "Return a JSON array only. Do not wrap it in markdown.",
    "",
    "Required axes:",
    "- visual fidelity",
    "- component architecture quality",
    "- token consistency",
    "",
    "Semantic rubric:",
    "```json",
    JSON.stringify(input.rubric, null, 2),
    "```",
    "",
    "Expected object schema:",
    "```json",
    JSON.stringify(input.schema, null, 2),
    "```",
    "",
    "Rules:",
    "- Emit one or more findings only for issues that materially affect implementation quality.",
    "- Use `layout` for hierarchy/spacing issues that are not primarily responsive.",
    "- Use `tokens` for typography/color/radius/shadow inconsistencies.",
    "- Use `architecture` for componentization, overflow, truncation, and reusable-state issues.",
    "- Use `iconography` for icon choice, icon styling, or icon/background conflicts.",
    "- Use `responsive` for viewport-specific issues.",
    "- Severity `high` should block pass.",
    "",
    `Stories in scope: ${input.stories.length}`,
  ].join("\n") + "\n";
}

function readSemanticOutput(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SemanticEvalFinding[];
  return Array.isArray(parsed) ? parsed : null;
}

function inferSemanticFindings(
  storyKey: string,
  title: string,
  exportName: string,
  iteration: LoopSummary["stories"][number]["iterations"][number],
) {
  const findings: SemanticEvalFinding[] = [];
  if (iteration.metrics.dimensionMismatch > 0.15) {
    findings.push({
      storyKey,
      severity: "high",
      category: "layout",
      finding: "Layout dimensions differ materially from the reference.",
      suggestedFix: "Adjust container sizing, vertical rhythm, and breakpoint constraints to align with the reference frame.",
      confidence: 0.83,
    });
  }
  if ((iteration.metrics.pixelDiffRatio ?? 0) > 0.12) {
    findings.push({
      storyKey,
      severity: "medium",
      category: "tokens",
      finding: "Visual delta suggests token mismatch in spacing, color, or typography.",
      suggestedFix: "Audit generated token usage for typography scale, palette roles, and spacing assignments.",
      confidence: 0.71,
    });
  }
  if (iteration.metrics.overflowCount > 0) {
    findings.push({
      storyKey,
      severity: "high",
      category: "architecture",
      finding: "Overflow indicates component constraints or truncation behavior are incorrect.",
      suggestedFix: "Split the layout into bounded reusable sections and fix overflow/truncation behavior before page-level polish.",
      confidence: 0.9,
    });
  }
  if (findings.length === 0) {
    findings.push({
      storyKey,
      severity: "low",
      category: "layout",
      finding: `${title}/${exportName} is semantically aligned with the current thresholds.`,
      suggestedFix: "No patch required.",
      confidence: 0.55,
    });
  }
  return findings;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function renderEvaluationReport(report: EvaluationReport, reportPath: string) {
  const lines = [
    "# Design QA Evaluation",
    "",
    `- Report: ${reportPath}`,
    `- Stories: ${report.stories.length}`,
    `- Visual fidelity: ${report.visualFidelity}`,
    `- Component architecture quality: ${report.componentArchitectureQuality}`,
    `- Token consistency: ${report.tokenConsistency}`,
    `- Semantic status: ${report.semanticStatus}`,
  ];

  if (report.semanticArtifacts) {
    lines.push(`- Semantic prompt: ${report.semanticArtifacts.promptPath}`);
    lines.push(`- Semantic input: ${report.semanticArtifacts.inputPath}`);
    lines.push(`- Semantic output: ${report.semanticArtifacts.outputPath}`);
  }

  lines.push("", "## Story Results");

  for (const story of report.stories) {
    lines.push(`- ${story.entryKey}: ${story.passed ? "pass" : "fail"} (score ${story.finalScore})`);
  }

  return `${lines.join("\n")}\n`;
}

function buildPatchPlan(
  summary: LoopSummary,
  report: EvaluationReport,
  config: LoadedDesignQaConfig,
  ir: ReturnType<typeof readDesignIr> | null,
  cwd: string,
  evalReportPath: string,
  semanticInputPath: string,
  semanticOutputPath: string,
) {
  return {
    generatedAt: new Date().toISOString(),
    rerunCommand: "design-qa eval",
    semanticStatus: report.semanticStatus,
    stories: report.stories
      .filter((story) => !story.passed)
      .map((story) => {
        const source = summary.stories.find((item) => item.entryKey === story.entryKey);
        const registryEntry = config.registry[story.entryKey];
        const codeConnectTargets = unique(
          (ir?.components ?? [])
            .filter((component) => component.storyKey === story.entryKey)
            .map((component) => component.codeConnectSourcePath)
            .filter((value): value is string => Boolean(value)),
        );
        const expectedTargetFiles = unique([
          registryEntry?.sourcePath,
          ...codeConnectTargets,
        ]).map((filePath) => normalizeRepoPath(filePath));
        const secondaryTargetFiles = expectedTargetFiles.slice(1);
        const tokenTargetFiles = story.semantic.some((item) => item.category === "tokens")
          ? unique(config.tokenSourcePaths).map((filePath) => normalizeRepoPath(filePath))
          : [];
        const referenceArtifacts = unique(
          [
            source?.iterations.at(-1)?.metrics.referencePath,
            source?.iterations.at(-1)?.metrics.screenshotPath,
            source?.iterations.at(-1)?.metrics.diffPath,
          ].filter((value): value is string => Boolean(value)),
        ).map((filePath) => normalizeRepoPath(filePath));
        const readonlyContextFiles = unique(
          [
            relativeToCwd(cwd, evalReportPath),
            relativeToCwd(cwd, semanticInputPath),
            report.semanticStatus === "complete" ? relativeToCwd(cwd, semanticOutputPath) : null,
            ...referenceArtifacts,
          ].filter((value): value is string => Boolean(value)),
        );
        return {
          storyKey: story.entryKey,
          primaryTargetFile: expectedTargetFiles[0] ?? normalizeRepoPath(registryEntry?.sourcePath ?? ""),
          expectedTargetFiles,
          secondaryTargetFiles,
          tokenTargetFiles,
          readonlyContextFiles,
          referenceArtifacts,
          failureCategories: [
            ...story.semantic.map((item) => item.category),
            ...(story.deterministic.passed ? [] : ["deterministic"]),
            ...(story.visual.passed ? [] : ["visual"]),
          ].filter((value, index, items) => items.indexOf(value) === index),
          semanticFindings: story.semantic,
          visualSummary: {
            score: story.visual.score,
            pixelDiffRatio: story.visual.pixelDiffRatio,
            dimensionMismatch: story.visual.dimensionMismatch,
            deterministicPassed: story.deterministic.passed,
          },
          rerunCommand: `design-qa eval --story "${story.entryKey}"`,
        };
      }),
  };
}

function renderPatchPrompt(plan: ReturnType<typeof buildPatchPlan>) {
  const lines = [
    "# Patch Prompt",
    "",
    `Generated at: ${plan.generatedAt}`,
    `Rerun command: ${plan.rerunCommand}`,
    "",
    "Use the failing stories below to create targeted code patches. Preserve Storybook-first workflow and token consistency.",
    "",
  ];
  for (const story of plan.stories) {
    lines.push(`## ${story.storyKey}`);
    lines.push(`- Failure categories: ${story.failureCategories.join(", ")}`);
    lines.push(`- Primary target file: ${story.primaryTargetFile || "unknown"}`);
    lines.push(`- Secondary target files: ${story.secondaryTargetFiles.join(", ") || "none"}`);
    lines.push(`- Token target files: ${story.tokenTargetFiles.join(", ") || "none"}`);
    lines.push(`- Expected target files: ${story.expectedTargetFiles.join(", ") || "none"}`);
    lines.push(`- Read-only context files: ${story.readonlyContextFiles.join(", ") || "none"}`);
    lines.push(`- Reference artifacts: ${story.referenceArtifacts.join(", ") || "none"}`);
    lines.push(`- Visual summary: score=${story.visualSummary.score}, pixelDiffRatio=${story.visualSummary.pixelDiffRatio ?? "n/a"}, dimensionMismatch=${story.visualSummary.dimensionMismatch}`);
    if (plan.semanticStatus !== "complete") {
      lines.push("- Semantic precision degraded: semantic findings are pending or incomplete.");
    }
    for (const finding of story.semanticFindings) {
      lines.push(`- ${finding.severity.toUpperCase()} ${finding.category}: ${finding.finding}`);
      lines.push(`- Suggested fix: ${finding.suggestedFix}`);
    }
    lines.push("- Do not edit generated artifacts unless the source file is itself generated and intentionally owned by this flow.");
    lines.push(`- Rerun: ${story.rerunCommand}`);
    lines.push("");
  }
  if (plan.stories.length === 0) {
    lines.push("All stories are passing. No patching required.");
  }
  return `${lines.join("\n")}\n`;
}

function normalizeRepoPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function unique(values: Array<string | null | undefined>) {
  return values.filter((value, index, items): value is string => Boolean(value) && items.indexOf(value) === index);
}
