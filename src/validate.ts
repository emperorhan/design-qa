import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

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
      if (config.validation.mode === "strict") {
        errors.push(`${entry.key} screenshot source is missing: ${entry.screenshotPath}`);
      }
    }
    if (sourceType === "screenshot" && !entry.screenshotPath && !entry.referencePath) {
      errors.push(`${entry.key} screenshot mode requires screenshotPath or referencePath`);
    }

    if (entry.referencePath && !fs.existsSync(path.join(cwd, entry.referencePath))) {
      if (config.validation.mode === "strict" || sourceType === "screenshot") {
        errors.push(`${entry.key} reference asset is missing: ${entry.referencePath}`);
      }
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
      } else if (entry.isFile() && /\.(stories)\.(ts|tsx|js|jsx)$/.test(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results.sort();
}

function extractMetaTitle(source: string) {
  const sourceFile = createSourceFile("meta.tsx", source);
  let title: string | null = null;
  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "meta" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          getPropertyName(property.name) === "title" &&
          ts.isStringLiteralLike(property.initializer)
        ) {
          title = property.initializer.text;
        }
      }
    }
  });
  return title;
}

function extractStoryUsages(filePath: string, source: string, title: string | null): StoryUsage[] {
  const usages: StoryUsage[] = [];
  const sourceFile = createSourceFile(filePath, source);
  const registryAliases = new Map<string, string>();
  walk(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const registryKey = extractRegistryKey(node.initializer, registryAliases);
      if (registryKey) {
        registryAliases.set(node.name.text, registryKey);
      }
      return;
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const exportName = declaration.name.text;
        const registryKey = extractRegistryKeyFromStoryInitializer(declaration.initializer, registryAliases);
        if (!registryKey) continue;
        usages.push({
          filePath,
          exportName,
          registryKey,
          title,
        });
      }
    }
  });
  return usages;
}

function createSourceFile(filePath: string, source: string) {
  const scriptKind = filePath.endsWith(".js")
    ? ts.ScriptKind.JS
    : filePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : filePath.endsWith(".tsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function getPropertyName(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function extractRegistryKeyFromStoryInitializer(
  expression: ts.Expression,
  aliases: Map<string, string>,
): string | null {
  if (!ts.isCallExpression(expression)) return null;
  const callee = expression.expression.getText();
  if (callee === "withRegisteredDesignQaStory") {
    const firstArg = expression.arguments[0];
    return firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : null;
  }
  if (callee === "withDesignQaStory") {
    const firstArg = expression.arguments[0];
    return firstArg ? extractRegistryKey(firstArg, aliases) : null;
  }
  return null;
}

function extractRegistryKey(expression: ts.Expression, aliases: Map<string, string>): string | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    return aliases.get(expression.text) ?? null;
  }
  if (ts.isElementAccessExpression(expression) && expression.expression.getText() === "DESIGN_QA_REGISTRY") {
    return ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : null;
  }
  if (ts.isPropertyAccessExpression(expression) && expression.expression.getText() === "DESIGN_QA_REGISTRY") {
    return expression.name.text;
  }
  if (ts.isCallExpression(expression) && expression.expression.getText() === "withRegisteredDesignQaStory") {
    const firstArg = expression.arguments[0];
    return firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : null;
  }
  return null;
}
