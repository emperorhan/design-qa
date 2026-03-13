import fs from "node:fs";
import path from "node:path";

import { validateIconDataset } from "./icons";
import { loadRuntimeConfig, extractNodeIdFromFigmaUrl, getDesignQaEntryByKey, relativeToCwd } from "./node";
import { getDesignSourceType, isFixtureEntry } from "./storybook";

interface StoryUsage {
  filePath: string;
  exportName: string;
  registryKey: string;
  title: string | null;
}

export async function validateStories(cwd = process.cwd()) {
  const { config } = await loadRuntimeConfig(cwd);
  const storyFiles = findStoryFiles(path.join(cwd, config.storyRoot));
  const usages: StoryUsage[] = [];
  const errors: string[] = [];

  for (const filePath of storyFiles) {
    const source = fs.readFileSync(filePath, "utf-8");
    const title = extractMetaTitle(source);
    usages.push(...extractStoryUsages(filePath, source, title));
  }

  const seenKeys = new Set<string>();
  for (const usage of usages) {
    const entry = getDesignQaEntryByKey(config, usage.registryKey);
    if (!entry) {
      errors.push(`${relativeToCwd(cwd, usage.filePath)}:${usage.exportName} references unknown registry key "${usage.registryKey}"`);
      continue;
    }
    if (isFixtureEntry(entry)) {
      continue;
    }

    seenKeys.add(entry.key);
    if (entry.exportName !== usage.exportName) {
      errors.push(`${relativeToCwd(cwd, usage.filePath)}:${usage.exportName} must match registry export name "${entry.exportName}"`);
    }
    if (relativeToCwd(cwd, usage.filePath) !== entry.sourcePath) {
      errors.push(`${relativeToCwd(cwd, usage.filePath)}:${usage.exportName} is mapped to ${entry.sourcePath} in registry`);
    }
    if (usage.title !== entry.title) {
      errors.push(`${relativeToCwd(cwd, usage.filePath)}:${usage.exportName} uses meta title "${usage.title}" but registry expects "${entry.title}"`);
    }

    const sourceType = getDesignSourceType(entry);
    if (sourceType !== "screenshot") {
      if (!entry.figmaNodeId || !entry.figmaUrl) {
        errors.push(`${entry.key} requires figmaNodeId and figmaUrl for ${sourceType} mode`);
      } else {
        const nodeIdFromUrl = extractNodeIdFromFigmaUrl(entry.figmaUrl);
        if (nodeIdFromUrl !== entry.figmaNodeId) {
          errors.push(`${entry.key} has mismatched figmaUrl (${nodeIdFromUrl ?? "none"}) and figmaNodeId (${entry.figmaNodeId})`);
        }
      }
    }

    if (sourceType !== "figma" && entry.screenshotPath && !fs.existsSync(path.join(cwd, entry.screenshotPath))) {
      errors.push(`${entry.key} screenshot source is missing: ${entry.screenshotPath}`);
    }
    if (sourceType === "screenshot" && !entry.screenshotPath && !entry.referencePath) {
      errors.push(`${entry.key} screenshot mode requires screenshotPath or referencePath`);
    }

    if (entry.referencePath && !fs.existsSync(path.join(cwd, entry.referencePath))) {
      errors.push(`${entry.key} reference asset is missing: ${entry.referencePath}`);
    }
  }

  for (const entry of Object.values(config.registry)) {
    if (isFixtureEntry(entry)) continue;
    if (!seenKeys.has(entry.key)) {
      errors.push(`Registry entry "${entry.key}" is not used by any story export in ${entry.sourcePath}`);
    }
  }

  const iconDataset = validateIconDataset(cwd);
  for (const error of iconDataset.errors) {
    errors.push(`Icon dataset: ${error}`);
  }

  if (errors.length > 0) {
    const message = `Figma story mapping validation failed:\n\n${errors.map((error) => `- ${error}`).join("\n")}`;
    throw new Error(message);
  }

  return {
    storyCount: usages.length,
    fileCount: storyFiles.length,
  };
}

function findStoryFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".stories.tsx")) {
        results.push(fullPath);
      }
    }
  }
  return results.sort();
}

function extractMetaTitle(source: string) {
  const titleMatch = source.match(/const\s+meta(?:\s*:[\s\S]*?)?\s*=\s*\{[\s\S]*?title:\s*["'`]([^"'`]+)["'`]/);
  return titleMatch?.[1] ?? null;
}

function extractStoryUsages(filePath: string, source: string, title: string | null): StoryUsage[] {
  const usages: StoryUsage[] = [];
  const patterns = [
    /export\s+const\s+(\w+)\s*:[^=]*=\s*withRegisteredDesignQaStory\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /export\s+const\s+(\w+)\s*=\s*withDesignQaStory\s*\(\s*DESIGN_QA_REGISTRY\[\s*["'`]([^"'`]+)["'`]\s*\]/g,
  ];

  for (const storyPattern of patterns) {
    for (const match of source.matchAll(storyPattern)) {
      const [, exportName, registryKey] = match;
      usages.push({
        filePath,
        exportName,
        registryKey,
        title,
      });
    }
  }

  return usages;
}
