import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { DesignQaEntry, DesignSourceType } from "./storybook";

export interface DesignQaCacheConfig {
  figma?: {
    preferLive?: boolean;
  };
}

export interface DesignQaEvaluationConfig {
  visualThreshold?: number;
  semantic?: {
    enabled?: boolean;
    severityThreshold?: "low" | "medium" | "high";
    outputFile?: string;
  };
}

export interface DesignQaGenerationConfig {
  outDir?: string;
  emitAgentDocs?: boolean;
}

export interface DesignQaConsumerConfig {
  storybookUrl?: string;
  threshold?: number;
  reportDir?: string;
  storyRoot?: string;
  mode?: DesignSourceType;
  irFile?: string;
  evalReportFile?: string;
  fixPromptFile?: string;
  generation?: DesignQaGenerationConfig;
  evaluation?: DesignQaEvaluationConfig;
  cache?: DesignQaCacheConfig;
  tokenSourcePaths?: string[];
  registryModule: string;
}

export interface LoadedDesignQaConfig extends Required<Omit<DesignQaConsumerConfig, "registryModule">> {
  cwd: string;
  registryModulePath: string;
  generation: Required<DesignQaGenerationConfig>;
  evaluation: Required<Omit<DesignQaEvaluationConfig, "semantic">> & {
    semantic: Required<NonNullable<DesignQaEvaluationConfig["semantic"]>>;
  };
  cache: Required<DesignQaCacheConfig>;
  registry: Record<string, DesignQaEntry>;
}

export async function loadDesignQaConfig(cwd = process.cwd()): Promise<LoadedDesignQaConfig> {
  const configPath = path.join(cwd, "designqa.config.ts");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing designqa.config.ts in ${cwd}`);
  }

  const imported = await import(pathToFileURL(configPath).href);
  const config = (imported.default ?? imported.config) as DesignQaConsumerConfig | undefined;
  if (!config) {
    throw new Error(`designqa.config.ts must export a default config object`);
  }

  const registryModulePath = path.resolve(cwd, config.registryModule);
  if (!fs.existsSync(registryModulePath)) {
    throw new Error(`Registry module not found: ${registryModulePath}`);
  }

  const registryModule = await import(pathToFileURL(registryModulePath).href);
  const registry = (registryModule.DESIGN_QA_REGISTRY ??
    registryModule.default) as Record<string, DesignQaEntry> | undefined;
  if (!registry) {
    throw new Error(`Registry module must export DESIGN_QA_REGISTRY or default`);
  }

  return {
    cwd,
    storybookUrl: config.storybookUrl ?? "http://127.0.0.1:6006",
    threshold: config.threshold ?? 90,
    reportDir: config.reportDir ?? ".design-qa",
    storyRoot: config.storyRoot ?? "src",
    mode: config.mode ?? "figma",
    irFile: config.irFile ?? ".design-qa/design-ir.json",
    evalReportFile: config.evalReportFile ?? ".design-qa/eval-report.json",
    fixPromptFile: config.fixPromptFile ?? ".design-qa/fix-prompt.md",
    generation: {
      outDir: config.generation?.outDir ?? ".design-qa/generated",
      emitAgentDocs: config.generation?.emitAgentDocs ?? true,
    },
    evaluation: {
      visualThreshold: config.evaluation?.visualThreshold ?? config.threshold ?? 90,
      semantic: {
        enabled: config.evaluation?.semantic?.enabled ?? true,
        severityThreshold: config.evaluation?.semantic?.severityThreshold ?? "medium",
        outputFile: config.evaluation?.semantic?.outputFile ?? ".design-qa/semantic-eval.output.json",
      },
    },
    cache: {
      figma: {
        preferLive: config.cache?.figma?.preferLive ?? true,
      },
    },
    tokenSourcePaths: config.tokenSourcePaths ?? [],
    registryModulePath,
    registry,
  };
}
