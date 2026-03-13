import path from "node:path";

import { runCollect, runInspectDataset, runValidateDataset } from "./dataset";
import { runEval } from "./eval";
import { runGenerateHandoff } from "./generate";
import { loadRuntimeConfig, relativeToCwd } from "./node";

export type DesignQaToolResult<T> = {
  ok: boolean;
  summary: string;
  data: T;
  artifacts: string[];
  warnings: string[];
  errors: string[];
  nextActions: string[];
};

type ToolOptions = {
  cwd?: string;
};

type CommandOptions = ToolOptions & {
  args?: string[];
};

export async function collectDesignQa(options: CommandOptions = {}): Promise<DesignQaToolResult<{
  reportDir: string;
  collectionPlan: string;
  datasetRoot: string;
}>> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await loadRuntimeConfig(cwd);
  const summary = await runCollect(options.args ?? [], cwd);
  return {
    ok: true,
    summary,
    data: {
      reportDir: relativeToCwd(cwd, runtime.reportRoot),
      collectionPlan: ".design-qa/figma/collection-plan.json",
      datasetRoot: ".design-qa/figma",
    },
    artifacts: [
      ".design-qa/figma/collection-plan.json",
      ".design-qa/figma/collection-plan.md",
      ".design-qa/agent-tasks/figma-dataset.json",
      ".design-qa/agent-tasks/figma-dataset.md",
    ],
    warnings: [],
    errors: [],
    nextActions: [
      "Fill .design-qa/figma/* with the host agent using the generated dataset task.",
      "Run design-qa validate-dataset --json after dataset files are updated.",
      "Run design-qa generate --json once the dataset is ready.",
    ],
  };
}

export async function generateDesignQa(options: CommandOptions = {}): Promise<DesignQaToolResult<{
  reportDir: string;
  irPath: string;
}>> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await loadRuntimeConfig(cwd);
  const summary = await runGenerateHandoff(options.args ?? [], cwd);
  return {
    ok: true,
    summary,
    data: {
      reportDir: relativeToCwd(cwd, runtime.reportRoot),
      irPath: relativeToCwd(cwd, runtime.irPath),
    },
    artifacts: [
      relativeToCwd(cwd, path.join(runtime.reportRoot, "authoring-context.json")),
      relativeToCwd(cwd, path.join(runtime.reportRoot, "authoring-brief.md")),
      relativeToCwd(cwd, path.join(runtime.reportRoot, "authoring-prompt.md")),
    ],
    warnings: [],
    errors: [],
    nextActions: [
      "Have the host agent read .design-qa/authoring-context.json and .design-qa/authoring-prompt.md.",
      "Write real React components and Storybook stories in the host source tree.",
      "Run your React Storybook host.",
      "Run design-qa eval --json when the target stories render.",
    ],
  };
}

export async function evaluateDesignQa(options: CommandOptions = {}): Promise<DesignQaToolResult<{
  evalReport: string;
  patchPlan: string;
  patchPrompt: string;
}>> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await loadRuntimeConfig(cwd);
  const summary = await runEval(options.args ?? [], cwd);
  return {
    ok: true,
    summary,
    data: {
      evalReport: relativeToCwd(cwd, runtime.evalReportPath),
      patchPlan: relativeToCwd(cwd, runtime.patchPlanPath),
      patchPrompt: relativeToCwd(cwd, runtime.patchPromptPath),
    },
    artifacts: [
      relativeToCwd(cwd, runtime.evalReportPath),
      relativeToCwd(cwd, runtime.patchPlanPath),
      relativeToCwd(cwd, runtime.patchPromptPath),
      relativeToCwd(cwd, runtime.semanticEvalInputPath),
      relativeToCwd(cwd, runtime.semanticEvalPromptPath),
    ],
    warnings: [],
    errors: [],
    nextActions: [
      "Have the host agent review .design-qa/patch-plan.json and patch source files only.",
      "Write semantic findings to .design-qa/semantic-eval.output.json when needed.",
      "Rerun design-qa eval --report-only --json after patching.",
    ],
  };
}

export async function validateDesignQaDataset(options: ToolOptions = {}): Promise<DesignQaToolResult<{
  datasetValidationJson: string;
  datasetValidationMarkdown: string;
}>> {
  const cwd = options.cwd ?? process.cwd();
  const runtime = await loadRuntimeConfig(cwd);
  const summary = await runValidateDataset(cwd);
  return {
    ok: true,
    summary,
    data: {
      datasetValidationJson: relativeToCwd(cwd, runtime.datasetValidationJsonPath),
      datasetValidationMarkdown: relativeToCwd(cwd, runtime.datasetValidationMarkdownPath),
    },
    artifacts: [
      relativeToCwd(cwd, runtime.datasetValidationJsonPath),
      relativeToCwd(cwd, runtime.datasetValidationMarkdownPath),
    ],
    warnings: [],
    errors: [],
    nextActions: [
      "If validation failed previously, review .design-qa/dataset-fix.json and recollect missing data.",
      "Run design-qa inspect-dataset --json for a quick status summary.",
      "Run design-qa generate --json when the dataset is ready.",
    ],
  };
}

export async function inspectDesignQaDataset(options: ToolOptions = {}): Promise<DesignQaToolResult<{
  datasetRoot: string;
}>> {
  const cwd = options.cwd ?? process.cwd();
  const summary = await runInspectDataset(cwd);
  return {
    ok: true,
    summary,
    data: {
      datasetRoot: ".design-qa/figma",
    },
    artifacts: [".design-qa/figma/manifest.json"],
    warnings: [],
    errors: [],
    nextActions: [
      "If asset export mode is remote-wrapper, recollect SVG assets with desktop MCP localhost export.",
      "If page depth is shallow, recollect nested page trees.",
      "If dataset looks healthy, continue with design-qa generate --json.",
    ],
  };
}
