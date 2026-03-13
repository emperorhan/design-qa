import fs from "node:fs";
import path from "node:path";

import { loadRuntimeConfig, relativeToCwd } from "./node";

type AgentKind = "codex" | "claude" | "generic";

export async function runExportAgentTask(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const taskType = args[0];
  if (taskType !== "figma-dataset" && taskType !== "patch") {
    throw new Error("Usage: design-qa export-agent-task <figma-dataset|patch> [--agent <codex|claude|generic>] [--story <name>] [--repo <path>]");
  }

  const agent = getStringArg(args, "--agent") as AgentKind | null;
  const storyFilter = getStringArg(args, "--story");
  const outDir = path.join(runtime.reportRoot, "agent-tasks");
  fs.mkdirSync(outDir, { recursive: true });

  if (taskType === "figma-dataset") {
    return exportFigmaDatasetTask(cwd, outDir, storyFilter, agent ?? "generic");
  }
  return exportPatchTask(cwd, outDir, storyFilter, agent ?? "generic");
}

function exportFigmaDatasetTask(cwd: string, outDir: string, storyFilter: string | null, agent: AgentKind) {
  const planPath = path.join(cwd, ".design-qa", "figma", "collection-plan.json");
  const instructionsPath = path.join(cwd, ".design-qa", "figma", "dataset-instructions.md");
  const schemaPath = path.join(cwd, ".design-qa", "figma", "dataset.schema.json");
  const fixJsonPath = path.join(cwd, ".design-qa", "dataset-fix.json");
  const fixPromptPath = path.join(cwd, ".design-qa", "dataset-fix-prompt.md");
  if (!fs.existsSync(planPath)) {
    throw new Error("Missing .design-qa/figma/collection-plan.json. Run design-qa prepare-figma-collection first.");
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf-8")) as Array<{
    collectionItemId: string;
    category: string;
    targetName: string;
    phase: "dataset" | "patch";
    storyKey?: string;
    figmaUrl?: string;
    nodeId?: string;
    collectionMode: string;
    requiredArtifacts: string[];
    requiredFiles: string[];
    presentFiles: string[];
    validationErrors: string[];
    priority: string;
    status: string;
    recommendedAction: string;
    notes: string[];
  }>;
  const filteredPlan = storyFilter
    ? plan.filter((item) =>
        `${item.collectionItemId} ${item.targetName} ${item.storyKey ?? ""}`.toLowerCase().includes(storyFilter.toLowerCase()),
      )
    : plan;
  const task = {
    phase: "dataset" as const,
    generatedAt: new Date().toISOString(),
    targetRepo: cwd,
    inputs: {
      collectionPlan: relativeToCwd(cwd, planPath),
      datasetInstructions: relativeToCwd(cwd, instructionsPath),
      datasetSchema: relativeToCwd(cwd, schemaPath),
      datasetFixJson: fs.existsSync(fixJsonPath) ? relativeToCwd(cwd, fixJsonPath) : null,
      datasetFixPrompt: fs.existsSync(fixPromptPath) ? relativeToCwd(cwd, fixPromptPath) : null,
    },
    outputs: {
      requiredFiles: [
        ".design-qa/figma/context.json",
        ".design-qa/figma/nodes.json",
        ".design-qa/figma/tokens.json",
        ".design-qa/figma/components.json",
        ".design-qa/figma/icons.json",
        ".design-qa/figma/manifest.json",
      ],
      optionalFiles: [
        ".design-qa/figma/screenshots/<node-id>.png",
        ".design-qa/figma/code-connect.json",
        ".design-qa/figma/constraints.json",
        ".design-qa/figma/typography-runs.json",
      ],
    },
    svgRules: {
      rootDimensions: "Do not keep fixed root width/height as the final contract. Preserve or restore viewBox instead.",
      color: "Normalize icon path fill/stroke to currentColor when possible.",
      background: "Keep icon backgrounds transparent. Remove non-semantic background rects; if a background is meaningful, record it separately as background guidance.",
      validity: "Icons without viewBox or viewport metadata are invalid.",
    },
    workItems: sortWorkItems(filteredPlan),
    completionCriteria: ["Run design-qa validate-dataset and reach zero validation errors."],
  };

  const jsonPath = path.join(outDir, "figma-dataset.json");
  const mdPath = path.join(outDir, "figma-dataset.md");
  const agentPath = path.join(outDir, `${agent}-figma-dataset.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(task, null, 2));
  fs.writeFileSync(mdPath, renderDatasetTaskMarkdown(task));
  fs.writeFileSync(agentPath, renderDatasetAgentPrompt(task, agent));

  return [
    "# Agent Task Export",
    "",
    `- Task: figma-dataset`,
    `- JSON: ${relativeToCwd(cwd, jsonPath)}`,
    `- Markdown: ${relativeToCwd(cwd, mdPath)}`,
    `- Agent prompt: ${relativeToCwd(cwd, agentPath)}`,
    `- Filter: ${storyFilter ?? "none"}`,
  ].join("\n") + "\n";
}

function exportPatchTask(cwd: string, outDir: string, storyFilter: string | null, agent: AgentKind) {
  const evalReportPath = path.join(cwd, ".design-qa", "eval-report.json");
  const patchPlanPath = path.join(cwd, ".design-qa", "patch-plan.json");
  const patchPromptPath = path.join(cwd, ".design-qa", "patch-prompt.md");
  const semanticOutputPath = path.join(cwd, ".design-qa", "semantic-eval.output.json");
  if (!fs.existsSync(patchPlanPath)) {
    throw new Error("Missing .design-qa/patch-plan.json. Run design-qa eval first.");
  }
  const patchPlan = JSON.parse(fs.readFileSync(patchPlanPath, "utf-8")) as {
    semanticStatus: "pending" | "complete" | "disabled";
    stories: Array<Record<string, unknown> & { storyKey: string }>;
  };
  const stories = storyFilter
    ? patchPlan.stories.filter((story) => story.storyKey.toLowerCase().includes(storyFilter.toLowerCase()))
    : patchPlan.stories;
  const task = {
    phase: "patch" as const,
    generatedAt: new Date().toISOString(),
    targetRepo: cwd,
    inputs: {
      evalReport: fs.existsSync(evalReportPath) ? relativeToCwd(cwd, evalReportPath) : null,
      patchPlan: relativeToCwd(cwd, patchPlanPath),
      patchPrompt: fs.existsSync(patchPromptPath) ? relativeToCwd(cwd, patchPromptPath) : null,
      semanticOutput: fs.existsSync(semanticOutputPath) ? relativeToCwd(cwd, semanticOutputPath) : null,
    },
    semanticStatus: patchPlan.semanticStatus,
    stories,
    completionCriteria: ["Edit source files only, then rerun design-qa eval --report-only."],
  };

  const jsonPath = path.join(outDir, "patch.json");
  const mdPath = path.join(outDir, "patch.md");
  const agentPath = path.join(outDir, `${agent}-patch.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(task, null, 2));
  fs.writeFileSync(mdPath, renderPatchTaskMarkdown(task));
  fs.writeFileSync(agentPath, renderPatchAgentPrompt(task, agent));

  return [
    "# Agent Task Export",
    "",
    `- Task: patch`,
    `- JSON: ${relativeToCwd(cwd, jsonPath)}`,
    `- Markdown: ${relativeToCwd(cwd, mdPath)}`,
    `- Agent prompt: ${relativeToCwd(cwd, agentPath)}`,
    `- Filter: ${storyFilter ?? "none"}`,
  ].join("\n") + "\n";
}

function renderDatasetTaskMarkdown(task: ReturnType<typeof buildDatasetTaskShape>) {
  const lines = [
    "# Figma Dataset Task",
    "",
    `- Target repo: ${task.targetRepo}`,
    `- Collection plan: ${task.inputs.collectionPlan}`,
    `- Dataset instructions: ${task.inputs.datasetInstructions}`,
    `- Dataset schema: ${task.inputs.datasetSchema}`,
    `- Dataset fix JSON: ${task.inputs.datasetFixJson ?? "none"}`,
    "",
    "## SVG Rules",
    `- Root dimensions: ${task.svgRules.rootDimensions}`,
    `- Color: ${task.svgRules.color}`,
    `- Background: ${task.svgRules.background}`,
    `- Validity: ${task.svgRules.validity}`,
    "",
    "## Work Items",
  ];
  for (const item of task.workItems) {
    lines.push(`- ${item.collectionItemId}: ${item.status} / ${item.recommendedAction}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderPatchTaskMarkdown(task: { targetRepo: string; semanticStatus: string; inputs: Record<string, string | null>; stories: Array<Record<string, unknown>> }) {
  const lines = [
    "# Patch Task",
    "",
    `- Target repo: ${task.targetRepo}`,
    `- Semantic status: ${task.semanticStatus}`,
    `- Eval report: ${task.inputs.evalReport ?? "none"}`,
    `- Patch plan: ${task.inputs.patchPlan ?? "none"}`,
    `- Patch prompt: ${task.inputs.patchPrompt ?? "none"}`,
    "",
    "## Story Targets",
  ];
  for (const story of task.stories) {
    lines.push(`- ${String(story.storyKey)} -> ${String(story.primaryTargetFile ?? "unknown")}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDatasetAgentPrompt(task: ReturnType<typeof buildDatasetTaskShape>, agent: AgentKind) {
  const persona = agent === "claude" ? "Claude Code" : agent === "codex" ? "Codex" : "agent";
  const lines = [
    `# ${persona} Figma Dataset Task`,
    "",
    `Work in ${task.targetRepo}.`,
    "Use native Figma MCP to fill the dataset files under `.design-qa/figma`.",
    "Do not edit source UI files in this phase.",
    "",
    "Read these files first:",
    `- ${task.inputs.collectionPlan}`,
    `- ${task.inputs.datasetInstructions}`,
    `- ${task.inputs.datasetSchema}`,
    ...(task.inputs.datasetFixJson ? [`- ${task.inputs.datasetFixJson}`] : []),
    ...(task.inputs.datasetFixPrompt ? [`- ${task.inputs.datasetFixPrompt}`] : []),
    "",
    "SVG collection rules for icons:",
    `- ${task.svgRules.rootDimensions}`,
    `- ${task.svgRules.color}`,
    `- ${task.svgRules.background}`,
    `- ${task.svgRules.validity}`,
    "",
    "Execute work items in this priority order:",
  ];
  for (const item of task.workItems) {
    lines.push(`- ${item.collectionItemId}: ${item.status}; ${item.recommendedAction}`);
    if (item.collectionMode === "selection") {
      lines.push(`- Use selection-based MCP for ${item.collectionItemId}.`);
    } else {
      lines.push(`- Use link-based MCP for ${item.collectionItemId}.`);
    }
    lines.push(`- Write files: ${item.requiredFiles.join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("When done, run `design-qa validate-dataset`.");
  lines.push("If validation fails, run `design-qa dataset-fix` and apply the repair plan.");
  return `${lines.join("\n")}\n`;
}

function renderPatchAgentPrompt(
  task: {
    targetRepo: string;
    semanticStatus: string;
    inputs: Record<string, string | null>;
    stories: Array<Record<string, unknown>>;
  },
  agent: AgentKind,
) {
  const persona = agent === "claude" ? "Claude Code" : agent === "codex" ? "Codex" : "agent";
  const lines = [
    `# ${persona} Patch Task`,
    "",
    `Work in ${task.targetRepo}.`,
    "Patch source files only. Do not edit generated artifacts.",
    "Read patch-plan.json first and patch the primary target file before secondary files.",
    ...(task.semanticStatus !== "complete" ? ["Semantic precision is degraded because semantic findings are pending or incomplete."] : []),
    "",
    "Read these files first:",
    ...(Object.values(task.inputs).filter((value): value is string => Boolean(value)).map((value) => `- ${value}`)),
    "",
    "Story patch targets:",
  ];
  for (const story of task.stories) {
    lines.push(`- ${String(story.storyKey)}: primary=${String(story.primaryTargetFile ?? "unknown")}`);
  }
  lines.push("");
  lines.push("When done, run `design-qa eval --report-only`.");
  return `${lines.join("\n")}\n`;
}

function sortWorkItems<T extends { status: string; priority: string }>(items: T[]) {
  const statusRank: Record<string, number> = { invalid: 0, partial: 1, ready: 2, pending: 3, collected: 4 };
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  return [...items].sort((left, right) => {
    const statusDelta = (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    return (priorityRank[left.priority] ?? 99) - (priorityRank[right.priority] ?? 99);
  });
}

function getStringArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function buildDatasetTaskShape() {
  return {
    phase: "dataset" as const,
    generatedAt: "",
    targetRepo: "",
    inputs: {
      collectionPlan: "",
      datasetInstructions: "",
      datasetSchema: "",
      datasetFixJson: null as string | null,
      datasetFixPrompt: null as string | null,
    },
    outputs: {
      requiredFiles: [] as string[],
      optionalFiles: [] as string[],
    },
    svgRules: {
      rootDimensions: "",
      color: "",
      background: "",
      validity: "",
    },
    workItems: [] as Array<{
      collectionItemId: string;
      status: string;
      recommendedAction: string;
      collectionMode: string;
      requiredFiles: string[];
      priority: string;
    }>,
    completionCriteria: [] as string[],
  };
}
