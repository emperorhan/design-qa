import fs from "node:fs";
import path from "node:path";

export async function runInit(cwd = process.cwd(), args: string[] = []) {
  const force = args.includes("--force");
  const files = new Map<string, string>([
    [
      path.join(cwd, "designqa.config.ts"),
      `export default {
  mode: "hybrid",
  storybookUrl: "http://127.0.0.1:6006",
  threshold: 90,
  reportDir: ".design-qa",
  storyRoot: "src",
  registryModule: "src/stories/designQa.ts",
  generation: {
    outDir: "src/generated/design-qa",
    emitAgentDocs: true,
  },
  evaluation: {
    visualThreshold: 90,
    semantic: {
      enabled: true,
      severityThreshold: "medium",
      outputFile: ".design-qa/semantic-eval.output.json",
    },
  },
  validation: {
    mode: "minimal",
    autoSyncManifest: true,
    autoSyncCollectionPlan: true,
  },
  tokenSourcePaths: [],
  cache: {
    figma: {
      preferLive: true,
    },
  },
};
`,
    ],
    [
      path.join(cwd, "src", "stories", "designQa.ts"),
      `import type { DesignQaEntry } from "@emperorhan/design-qa/storybook";

export const DESIGN_QA_REGISTRY = {
  "Pages/Example.Default": {
    key: "Pages/Example.Default",
    title: "Pages/Example",
    exportName: "Default",
    fixture: true,
    sourceType: "hybrid",
    sourcePath: "src/stories/Example.stories.tsx",
    figmaNodeId: "123:456",
    figmaUrl: "https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=123-456",
    screenshotPath: "figma-refs/screens/example-default.png",
    referencePath: "figma-refs/screens/example-default.png",
    designIrId: "pages-example-default",
    evaluationProfile: "default",
  },
} as const satisfies Record<string, DesignQaEntry>;
`,
    ],
    [
      path.join(cwd, "src", "stories", "Example.stories.tsx"),
      `import { withDesignQaStory } from "@emperorhan/design-qa/storybook";
import { DESIGN_QA_REGISTRY } from "./designQa";

const meta = {
  title: "Pages/Example",
};

export default meta;

export const Default = withDesignQaStory(DESIGN_QA_REGISTRY["Pages/Example.Default"], {
  render: () => <div>Replace this example story with your real UI.</div>,
});
`,
    ],
    [
      path.join(cwd, "figma-refs", "screens", "example-default.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8//8/AwwwMSAB3BwAlm4DBfIlvvkAAAAASUVORK5CYII=",
        "base64",
      ).toString("binary"),
    ],
    [
      path.join(cwd, "AGENTS.md"),
      `# UI Design QA Workflow

This repository is expected to use design-qa as an agent toolkit.

When the user asks for UI completion with design-qa, follow this sequence:

1. Run \`design-qa doctor\`.
2. If Figma dataset is missing or stale, run \`design-qa collect --json\`.
3. Fill or repair \`.design-qa/figma/*\` using native Figma MCP.
4. Run \`design-qa validate-dataset --json\`.
5. Run \`design-qa generate --json\`.
6. Ensure React Storybook is running.
7. Run \`design-qa eval --json\`.
8. Patch source files only, then rerun \`design-qa eval --report-only --json\`.

Ask the user only when one of these is missing:

- Figma desktop MCP address if it is not the default \`http://127.0.0.1:3845/mcp\`
- target Figma file, page, frame, or node scope
- confirmation of which UI scope to build first when multiple scopes are possible
- React Storybook host setup if the repo is not ready

Do not ask for information already present in \`designqa.config.ts\`, \`.design-qa/figma/*\`, or the registry.

## Dataset Phase

Inputs:
- \`.design-qa/figma/collection-plan.json\`
- \`.design-qa/figma/dataset-instructions.md\`
- \`.design-qa/figma/dataset.schema.json\`

Outputs:
- \`.design-qa/figma/*\`
- \`.design-qa/figma/manifest.json\`

Completion:
1. Fill the dataset with native Figma MCP.
2. Generate a ready-to-run task with \`design-qa export-agent-task figma-dataset --agent codex\` or \`--agent claude\`.
3. Run \`design-qa validate-dataset\`.
4. If validation fails, use \`.design-qa/dataset-fix.json\` and \`.design-qa/dataset-fix-prompt.md\`.

## Patch Phase

Inputs:
- \`.design-qa/eval-report.json\`
- \`.design-qa/patch-plan.json\`
- \`.design-qa/patch-prompt.md\`
- \`.design-qa/semantic-eval.output.json\`

Outputs:
- source file edits only

Completion:
1. Patch the primary target file first.
2. Treat generated artifacts as read-only context.
3. Generate a ready-to-run task with \`design-qa export-agent-task patch --agent codex\` or \`--agent claude\`.
4. Rerun \`design-qa eval --report-only\`.
`,
    ],
    [
      path.join(cwd, "CLAUDE.md"),
      `# Claude Code Design QA

- Work from the frontend repo root.
- Prefer \`npx design-qa ...\` when installed locally.
- Treat design-qa as a toolkit, not as the coding agent itself.
- Prefer \`--json\` outputs so you can decide the next action programmatically.
- If a user asks to build UI from Figma with design-qa, first inspect the repo, then ask only for missing Figma MCP address or target scope.
- Dataset phase: read collection-plan, dataset-instructions, dataset.schema and write only \`.design-qa/figma/*\`.
- Patch phase: read eval-report, patch-plan, patch-prompt, semantic output and patch source files only.
- Use \`.design-qa/patch-plan.json\` to identify the primary source file before editing.
`,
    ],
    [
      path.join(cwd, "codex_prompt.md"),
      `# Codex Design QA Prompt

Use the generated Design QA artifacts as the contract:

- \`.design-qa/design-ir.json\`
- \`.design-qa/eval-report.json\`
- \`.design-qa/dataset-validation.json\`
- \`.design-qa/dataset-fix.json\`
- \`.design-qa/semantic-eval.input.json\`
- \`.design-qa/semantic-eval-prompt.md\`
- \`.design-qa/patch-plan.json\`
- \`.design-qa/patch-prompt.md\`
- \`.design-qa/agent-tasks/*.json\`
- \`.design-qa/agent-tasks/*.md\`
- \`.design-qa/fix-prompt.md\`

Dataset phase writes only \`.design-qa/figma/*\`. Patch phase edits only source files listed in \`.design-qa/patch-plan.json\`.
When semantic findings are requested, write JSON to \`.design-qa/semantic-eval.output.json\`.
Use \`design-qa collect --json\`, \`design-qa generate --json\`, and \`design-qa eval --json\` as the primary toolkit commands.
Ask the user for Figma desktop MCP address only if it is not the default \`http://127.0.0.1:3845/mcp\`, or if the target file/page/frame scope cannot be inferred from the repo or dataset.
`,
    ],
    [
      path.join(cwd, ".design-qa", "README.md"),
      `# Design QA Working Directory

Generated artifacts:

- design-ir.json
- eval-report.json
- fix-prompt.md
- semantic-eval.input.json
- semantic-eval-prompt.md
- semantic-eval.output.json
- dataset-validation.json
- dataset-validation.md
- dataset-fix.json
- dataset-fix-prompt.md
- patch-plan.json
- patch-prompt.md
- generated code lives in ../src/generated/design-qa

Runtime expectations:

- design-qa is React-first
- generated stories/components target React Storybook hosts
- non-React Storybook frameworks such as html-vite are not supported for generated scaffolds
`,
    ],
    [
      path.join(cwd, ".design-qa", "figma", "collection-plan.template.json"),
      JSON.stringify(
        [
          {
            id: "asset:favicon",
            category: "asset",
            name: "favicon",
            targetName: "Favicon",
            collectionMode: "link",
            requiredArtifacts: ["svg-or-png", "background-guidance"],
            priority: "P0",
            status: "pending",
            notes: ["Fill in the Figma link for the canonical favicon source."],
          },
        ],
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "README.md"),
      `# Figma Dataset

Preferred workflow:

1. Use Codex or Claude Code with Figma native MCP.
2. Use a React app with a React Storybook framework such as \`@storybook/react-vite\`.
3. Run \`design-qa prepare-figma-collection\`.
4. Use \`.design-qa/figma/collection-plan.json\` to collect tokens, assets, icons, components, and pages.
5. Write dataset files into this directory.
6. Run \`design-qa validate-dataset\`.
7. If validation fails, consume \`.design-qa/dataset-fix.json\` and \`.design-qa/dataset-fix-prompt.md\` and regenerate the missing files.
8. Use \`design-qa export-agent-task figma-dataset --agent codex\` or \`--agent claude\` when you want a ready-to-run MCP task prompt.
9. Run \`design-qa ingest figma\`.

If the dataset cannot be collected automatically, ask the user only for:

- Figma desktop MCP address when it differs from \`http://127.0.0.1:3845/mcp\`
- target file or page scope
- frame or node link when the target scope is ambiguous

Non-React Storybook frameworks such as \`@storybook/html-vite\` are not supported for generated Design QA stories.
`,
    ],
    [
      path.join(cwd, ".design-qa", "figma", "dataset-instructions.md"),
      `# Figma Dataset Instructions

Use native Figma MCP to prepare the dataset in this order:

1. context.json
2. nodes.json
3. tokens.json
4. components.json
5. icons.json
6. screenshots/<node-id>.png when available
7. manifest.json

Required manifest fields:
- datasetVersion
- extractionMode
- generatedAt
- includedFiles
- nodeCoverage
- completeness
- warnings

Asset conventions:
- favicon: \`assets/favicon.svg\` or \`assets/favicon.png\` plus \`assets/favicon.background.json\`
- og-image: \`assets/og-image.png\` plus \`assets/og-image.background.json\`

Collection rules:
- asset items use link-based MCP
- token items use selection-based MCP from canonical token source frames
- icon items require \`icons.json\` plus SVG export
- page items require \`screenshots/<node-id>.png\` when available
- component items must land in \`components.json\` with variants or sourceNodeId
- remote MCP asset wrappers do not count as successful SVG exports
- prefer desktop MCP localhost asset export when SVG assets are required
- store raw icon exports separately from normalized outputs
- icon SVGs should preserve or restore viewBox, avoid fixed root width/height in the final contract, use currentColor for fill/stroke when possible, and keep non-semantic backgrounds transparent
`,
    ],
    [
      path.join(cwd, ".design-qa", "figma", "dataset.schema.json"),
      JSON.stringify(
        {
          manifest: {
            datasetVersion: "number",
            extractionMode: "native-mcp-remote | native-mcp-desktop | direct-mcp",
            mcpSource: "remote | desktop | mixed | unknown",
            assetExportMode: "local-export | remote-wrapper | mixed | unavailable",
            desktopAssetBaseUrl: "optional base URL",
            pageCollectionDepth: "shallow | nested | full-canvas",
            svgNormalization: "raw-only | partial | complete",
            registryMode: "real | contains-placeholders",
            generatedAt: "ISO date string",
            includedFiles: ["string"],
            completeness: {
              context: "boolean",
              nodes: "boolean",
              tokens: "boolean",
              components: "boolean",
              icons: "boolean",
            },
          },
        },
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "assets", "README.md"),
      `# Figma Asset Dataset

- Put favicon assets here as \`favicon.svg\`, \`favicon.png\`, or \`favicon.ico\`.
- Put OG image assets here as \`og-image.png\`, \`og-image.jpg\`, or \`og-image.jpeg\`.
- For each asset, add a matching \`*.background.json\` file describing any non-transparent background requirements.
`,
    ],
    [
      path.join(cwd, ".design-qa", "figma", "manifest.template.json"),
      JSON.stringify(
        {
          datasetVersion: 1,
          extractionMode: "native-mcp-desktop",
          mcpSource: "desktop",
          assetExportMode: "local-export",
          desktopAssetBaseUrl: "http://127.0.0.1:3845",
          pageCollectionDepth: "nested",
          svgNormalization: "raw-only",
          registryMode: "real",
          generatedAt: new Date(0).toISOString(),
          fileKey: "FILE_KEY",
          fileName: "Example File",
          pageName: "Page Name",
          includedFiles: ["context.json", "nodes.json", "tokens.json", "components.json", "icons.json"],
          nodeCoverage: {
            totalRegistryNodes: 0,
            coveredRegistryNodes: 0,
            missingNodeIds: [],
          },
          completeness: {
            context: true,
            nodes: true,
            tokens: true,
            components: true,
            icons: true,
          },
          warnings: [],
        },
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "context.json"),
      JSON.stringify(
        {
          fileKey: "FILE_KEY",
          fileName: "Example File",
          pageName: "Page Name",
          pageId: "0:1",
          selectionCount: 1,
          nodeIds: ["123:456"],
        },
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "nodes.json"),
      JSON.stringify(
        [
          {
            id: "123:456",
            name: "Example Screen",
            type: "FRAME",
            children: [
              {
                id: "123:457",
                name: "Download Icon",
                type: "VECTOR",
              },
            ],
          },
        ],
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "tokens.json"),
      JSON.stringify(
        {
          color: [{ name: "surface/default", value: "#FFFFFF", role: "surface" }],
          typography: [{ name: "body/md", value: "400 16px/24px Inter" }],
          spacing: [{ name: "space/16", value: 16 }],
          radius: [{ name: "radius/8", value: 8 }],
          shadow: [{ name: "shadow/sm", value: "0 1px 2px rgba(0,0,0,0.08)" }],
          motion: [{ name: "motion/base", value: "180ms ease-in-out" }],
        },
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "components.json"),
      JSON.stringify(
        [
          {
            id: "component-1",
            name: "ExampleCard",
            storyKey: "Pages/Example.Default",
            variants: ["Default"],
            sourceNodeId: "123:456",
            codeConnect: {
              sourcePath: "src/components/ExampleCard.tsx",
              exportName: "ExampleCard",
            },
          },
        ],
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "icons.json"),
      JSON.stringify(
        [
          {
            id: "icon-download-16",
            name: "download",
            nodeId: "123:457",
            variant: "line",
            semanticRole: "action/download",
            source: "desktop",
            exportKind: "local-svg",
            normalizationStatus: "raw",
            rawSvgPath: ".design-qa/figma/icons/icon-download-16.svg",
            svgPath: ".design-qa/figma/icons/icon-download-16.svg",
            normalizedSvgPath: ".design-qa/figma/icons/normalized/icon-download-16.svg",
            originalRef: "http://127.0.0.1:3845/assets/icon-download-16.svg",
            resolvedLocalPath: ".design-qa/figma/icons/icon-download-16.svg",
            usage: ["Pages/Example.Default"],
            usagePages: ["Pages/Example.Default"],
            usageNodes: ["123:456"],
            libraryCandidate: "download",
            viewport: { width: 16, height: 16 },
            background: {
              hasFill: false,
              fillColor: null,
            },
          },
        ],
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "manifest.json"),
      JSON.stringify(
        {
          datasetVersion: 1,
          extractionMode: "native-mcp-desktop",
          mcpSource: "desktop",
          assetExportMode: "local-export",
          desktopAssetBaseUrl: "http://127.0.0.1:3845",
          pageCollectionDepth: "nested",
          svgNormalization: "raw-only",
          registryMode: "real",
          generatedAt: new Date().toISOString(),
          fileKey: "FILE_KEY",
          fileName: "Example File",
          pageName: "Page Name",
          includedFiles: ["context.json", "nodes.json", "tokens.json", "components.json", "icons.json"],
          nodeCoverage: {
            totalRegistryNodes: 0,
            coveredRegistryNodes: 0,
            missingNodeIds: [],
          },
          completeness: {
            context: true,
            nodes: true,
            tokens: true,
            components: true,
            icons: true,
          },
          warnings: [],
        },
        null,
        2,
      ) + "\n",
    ],
    [
      path.join(cwd, ".design-qa", "figma", "icons", "icon-download-16.svg"),
      `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="16" height="16" fill="#FFFFFF"/>
  <path d="M8 2V10M8 10L5.5 7.5M8 10L10.5 7.5M3 12.5H13" stroke="#111827" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`,
    ],
  ]);

  const results: Array<{ file: string; action: "created" | "skipped" | "overwritten" }> = [];
  for (const [filePath, content] of files) {
    results.push(writeFile(filePath, content, force));
  }

  const lines = [
    "# Design QA Init",
    "",
    `- Target repo: ${cwd}`,
    `- Force: ${force ? "yes" : "no"}`,
    "",
    "## Files",
  ];
  for (const result of results) {
    lines.push(`- ${result.action}: ${path.relative(cwd, result.file)}`);
  }

  lines.push("");
  lines.push("## Next Steps");
  lines.push("- Add @emperorhan/design-qa as a devDependency in this repo or use a global install.");
  lines.push("- Run `design-qa doctor --repo <path>` or from the repo root.");
  lines.push("- Run `design-qa prepare-figma-collection` to generate the collection checklist.");
  lines.push("- Run `design-qa export-agent-task figma-dataset --agent codex` or `--agent claude` to generate a ready-to-run dataset task.");
  lines.push("- Ask Codex or Claude Code with native Figma MCP to fill `.design-qa/figma/*` according to the collection plan.");
  lines.push("- Run `design-qa validate-dataset` before ingesting Figma data.");
  lines.push("- If validation fails, run `design-qa dataset-fix` and hand `.design-qa/dataset-fix.json` plus `.design-qa/dataset-fix-prompt.md` to the agent.");
  lines.push("- Populate src/stories/designQa.ts with real mappings.");
  lines.push("- Replace src/stories/Example.stories.tsx with a real Storybook story or remove the example entry.");
  lines.push("- Run `design-qa ingest ...`, `design-qa generate storybook`, `design-qa eval`, then use `.design-qa/patch-plan.json` and `.design-qa/patch-prompt.md` for patching.");
  lines.push("");
  lines.push("## Suggested package.json scripts");
  lines.push("- `design:qa:doctor`: `design-qa doctor`");
  lines.push("- `design:qa:validate-dataset`: `design-qa validate-dataset`");
  lines.push("- `design:qa:dataset-fix`: `design-qa dataset-fix`");
  lines.push("- `design:qa:prepare-collection`: `design-qa prepare-figma-collection`");
  lines.push("- `design:qa:task:dataset`: `design-qa export-agent-task figma-dataset --agent codex`");
  lines.push("- `design:qa:task:patch`: `design-qa export-agent-task patch --agent codex`");
  lines.push("- `design:qa:ingest`: `design-qa ingest hybrid --figma <url> --screenshot <path>`");
  lines.push("- `design:qa:generate`: `design-qa generate storybook`");
  lines.push("- `design:qa:eval`: `design-qa eval`");
  lines.push("- `design:qa:fix`: `design-qa fix`");
  lines.push("- `design:qa:loop`: `design-qa loop --max-iterations 5`");

  return `${lines.join("\n")}\n`;
}

function writeFile(filePath: string, content: string, force: boolean) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !force) {
    return { file: filePath, action: "skipped" as const };
  }
  if (filePath.endsWith(".png")) {
    fs.writeFileSync(filePath, Buffer.from(content, "binary"));
  } else {
    fs.writeFileSync(filePath, content);
  }
  return { file: filePath, action: (fs.existsSync(filePath) && force ? "overwritten" : "created") as "created" | "overwritten" };
}
