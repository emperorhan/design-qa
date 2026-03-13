import fs from "node:fs";
import path from "node:path";

import { normalizeIconDataset, renderIconsModule } from "./icons";
import type { DesignIR } from "./ir";
import { loadExistingOrSeedIr } from "./ingest";
import { relativeToCwd } from "./node";

const GENERATED_STATES = ["default", "hover", "active", "disabled", "error", "loading", "empty", "long-text", "mobile"];

export async function runGenerateStorybook(_args: string[], cwd = process.cwd()) {
  const { runtime, ir } = await loadExistingOrSeedIr(cwd);
  fs.mkdirSync(runtime.generationDir, { recursive: true });

  const tokensPath = path.join(runtime.generationDir, "tokens.generated.ts");
  const componentsPath = path.join(runtime.generationDir, "components.generated.tsx");
  const storiesPath = path.join(runtime.generationDir, "designqa.generated.stories.tsx");
  const registryPath = path.join(runtime.generationDir, "registry.generated.json");
  const iconsPath = path.join(runtime.generationDir, "icons.generated.tsx");

  const normalizedIcons = normalizeIconDataset(cwd, runtime.generationDir);

  fs.writeFileSync(tokensPath, renderTokensModule(ir));
  fs.writeFileSync(componentsPath, renderComponentsModule(ir));
  fs.writeFileSync(storiesPath, renderStoriesModule(ir));
  fs.writeFileSync(registryPath, JSON.stringify(buildGeneratedRegistry(ir), null, 2));
  fs.writeFileSync(iconsPath, renderIconsModule(normalizedIcons.icons));

  return [
    "# Storybook Generation",
    "",
    `- IR: ${relativeToCwd(cwd, runtime.irPath)}`,
    `- Tokens: ${relativeToCwd(cwd, tokensPath)}`,
    `- Components: ${relativeToCwd(cwd, componentsPath)}`,
    `- Stories: ${relativeToCwd(cwd, storiesPath)}`,
    `- Registry: ${relativeToCwd(cwd, registryPath)}`,
    `- Icons: ${relativeToCwd(cwd, iconsPath)}`,
    ...(normalizedIcons.icons.length > 0 ? [`- Normalized icon SVGs: ${relativeToCwd(cwd, normalizedIcons.normalizedDir)}`] : []),
  ].join("\n") + "\n";
}

function renderTokensModule(ir: DesignIR) {
  return [
    `export const designTokens = ${JSON.stringify(ir.tokens, null, 2)} as const;`,
    `export const semanticRoles = ${JSON.stringify(ir.semanticRoles, null, 2)} as const;`,
    "",
  ].join("\n");
}

function renderComponentsModule(ir: DesignIR) {
  const body = ir.components
    .map((component) => {
      const componentName = sanitizeIdentifier(component.name);
      const hint = component.states.join(", ");
      return `export function ${componentName}(props: { state?: string } = {}) {\n  return (\n    <div data-design-qa-component="${component.storyKey ?? componentName}" data-state={props.state ?? "default"}>\n      <strong>${component.name}</strong>\n      <span>${hint}</span>\n    </div>\n  );\n}\n`;
    })
    .join("\n");

  return `import React from "react";\n\n${body}`;
}

function renderStoriesModule(ir: DesignIR) {
  const imports = ir.components
    .map((component) => sanitizeIdentifier(component.name))
    .filter((name, index, items) => items.indexOf(name) === index);
  const importLine = imports.length > 0 ? `import { ${imports.join(", ")} } from "./components.generated";` : `import "./components.generated";`;

  const storyBlocks = ir.components
    .map((component) => {
      const componentName = sanitizeIdentifier(component.name);
      const title = component.storyKey?.split(".").slice(0, -1).join("/") || `Generated/${component.name}`;
      const stories = GENERATED_STATES.map(
        (state) =>
          `export const ${componentName}${toPascalCase(state)} = { name: "${state}", render: () => <${componentName} state="${state}" /> };\n`,
      ).join("");
      return [
        `const ${componentName}Meta = {`,
        `  title: "${title}",`,
        `  component: ${componentName},`,
        `  tags: ["design-qa", "generated"],`,
        `};`,
        `export { ${componentName}Meta };`,
        stories,
      ].join("\n");
    })
    .join("\n\n");

  return `import React from "react";\n${importLine}\n\n${storyBlocks}\n`;
}

function buildGeneratedRegistry(ir: DesignIR) {
  return ir.components.map((component) => ({
    key: component.storyKey ?? component.name,
    component: component.name,
    source: component.source,
    variants: component.variants,
    states: component.states,
    needsVerification: component.needsVerification ?? false,
    verificationTargets: ir.verificationTargets.filter((target) => target.id.includes(component.storyKey ?? "")),
  }));
}

function sanitizeIdentifier(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const pascal = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
  return pascal || "GeneratedComponent";
}

function toPascalCase(value: string) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}
