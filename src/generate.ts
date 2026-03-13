import fs from "node:fs";
import path from "node:path";

import { normalizeIconDataset } from "./icons";
import type { DesignIR } from "./ir";
import { loadExistingOrSeedIr } from "./ingest";
import { detectStorybookFrameworkSupport, relativeToCwd } from "./node";

export async function runGenerateHandoff(_args: string[], cwd = process.cwd()) {
  const frameworkSupport = detectStorybookFrameworkSupport(cwd);
  if (!frameworkSupport.supported) {
    throw new Error(
      [
        "design-qa generate is React-first and expects a React Storybook host.",
        `Detected: ${frameworkSupport.detail}.`,
        frameworkSupport.action,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const { runtime, ir } = await loadExistingOrSeedIr(cwd);
  fs.mkdirSync(runtime.reportRoot, { recursive: true });

  const contextPath = path.join(runtime.reportRoot, "authoring-context.json");
  const briefPath = path.join(runtime.reportRoot, "authoring-brief.md");
  const promptPath = path.join(runtime.reportRoot, "authoring-prompt.md");
  const normalizedIcons = normalizeIconDataset(cwd, runtime.reportRoot);

  const context = buildAuthoringContext(ir, {
    sourceRoot: runtime.config.storyRoot,
    irPath: relativeToCwd(cwd, runtime.irPath),
    normalizedIconDir:
      normalizedIcons.icons.length > 0 ? relativeToCwd(cwd, normalizedIcons.normalizedDir) : null,
  });

  fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
  fs.writeFileSync(briefPath, renderAuthoringBrief(context));
  fs.writeFileSync(promptPath, renderAuthoringPrompt(context));

  return [
    "# Design QA Generate",
    "",
    `- Mode: handoff`,
    `- IR: ${relativeToCwd(cwd, runtime.irPath)}`,
    `- Authoring context: ${relativeToCwd(cwd, contextPath)}`,
    `- Authoring brief: ${relativeToCwd(cwd, briefPath)}`,
    `- Authoring prompt: ${relativeToCwd(cwd, promptPath)}`,
    ...(normalizedIcons.icons.length > 0 ? [`- Normalized icon SVGs: ${relativeToCwd(cwd, normalizedIcons.normalizedDir)}`] : []),
  ].join("\n") + "\n";
}

function buildAuthoringContext(
  ir: DesignIR,
  runtime: {
    sourceRoot: string;
    irPath: string;
    normalizedIconDir: string | null;
  },
) {
  return {
    generatedAt: new Date().toISOString(),
    irPath: runtime.irPath,
    generationTarget: "host-source-files",
    sourceRoot: runtime.sourceRoot,
    normalizedIconDir: runtime.normalizedIconDir,
    tokens: ir.tokens,
    semanticRoles: ir.semanticRoles,
    components: ir.components.map((component) => ({
      name: component.name,
      storyKey: component.storyKey,
      source: component.source,
      variants: component.variants,
      states: component.states,
      needsVerification: component.needsVerification ?? false,
      confidence: component.confidence,
    })),
    pages: ir.pages,
    verificationTargets: ir.verificationTargets,
    instructions: [
      "Author real React components and Storybook stories in the host source tree.",
      "Do not treat generated artifacts as the source of truth.",
      "Use source stories and source components as the patch targets.",
      "Prefer tokenized styling, reusable components, and state coverage in Storybook.",
      "After authoring or patching code, run design-qa eval --json.",
    ],
  };
}

function renderAuthoringBrief(context: ReturnType<typeof buildAuthoringContext>) {
  const lines = [
    "# Design QA Authoring Brief",
    "",
    `- IR: ${context.irPath}`,
    `- Generation target: ${context.generationTarget}`,
    `- Suggested source tree: ${context.sourceRoot}`,
    `- Normalized icons: ${context.normalizedIconDir ?? "none"}`,
    "",
    "## Goal",
    "Write real React components and Storybook stories in the host repository so the UI matches the collected Figma dataset.",
    "",
    "## Rules",
    "- Author source files, not generated artifacts.",
    "- Use React and React Storybook only.",
    "- Cover component states in Storybook.",
    "- Use normalized icons and tokenized styling when available.",
    "- Preserve reusable component boundaries.",
    "",
    "## Components",
  ];

  for (const component of context.components) {
    lines.push(`- ${component.name}: states=${component.states.join(", ")}; variants=${component.variants.join(", ") || "none"}`);
  }

  lines.push("");
  lines.push("## Verification Targets");
  for (const target of context.verificationTargets) {
    lines.push(`- ${target.label}: ${target.reason}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderAuthoringPrompt(context: ReturnType<typeof buildAuthoringContext>) {
  return [
    "# Design QA Authoring Prompt",
    "",
    "Use the provided Design QA context to author or update real React source files and Storybook stories.",
    "Read `.design-qa/authoring-context.json` first.",
    "Implement source components and stories that match the collected Figma data.",
    "Do not edit generated artifacts as the primary solution.",
    "After writing or updating code, rerun `design-qa eval --json` and use `.design-qa/patch-plan.json` for the next iteration.",
    "",
    "Focus on:",
    "- visual fidelity",
    "- component architecture quality",
    "- token consistency",
    "- Storybook state coverage",
  ].join("\n") + "\n";
}
