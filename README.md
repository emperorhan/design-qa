# @emperorhan/design-qa

Figma to Storybook Design QA toolkit for [Claude Code](https://claude.ai/claude-code).
Run `/design-qa <Component>` to perform automated Figma-based design QA.

## Prerequisites

| Tool | Required | Description |
|------|----------|-------------|
| [Claude Code](https://claude.ai/claude-code) | Yes | AI coding agent |
| [React](https://react.dev/) | Yes | UI framework |
| [Storybook](https://storybook.js.org/) (React) | Yes | Component development environment |
| [agent-browser](https://www.npmjs.com/package/@anthropic-ai/agent-browser) | Yes | Screenshot QA tool |
| [Figma](https://www.figma.com/) desktop app | Recommended | Design source |
| [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) | Recommended | Figma <-> Claude Code bridge (no token required) |

## Setup

```bash
# 1. Install in your project
pnpm add -D @emperorhan/design-qa
# or
npm install -D @emperorhan/design-qa

# 2. Initialize project
npx @emperorhan/design-qa init

# 3. Check prerequisites
npx @emperorhan/design-qa doctor
```

### Files created by init

```
your-project/
├── designqa.config.ts              # Project configuration
├── src/stories/designQa.ts         # Figma <-> Story mapping registry
├── figma-refs/.gitkeep             # Figma reference image storage
└── .claude/skills/design-qa/
    └── SKILL.md                    # Claude Code skill definition
```

### init options

```bash
npx @emperorhan/design-qa init \
  --dir ./my-project \              # Project directory
  --tokens src/styles/tokens.css \  # CSS tokens file path
  --skip-doctor \                   # Skip prerequisite check
  --force                           # Overwrite existing files
```

### doctor checks

```bash
npx @emperorhan/design-qa doctor
```

```
Design QA Doctor

  ✓ Claude Code — Installed
  ✓ agent-browser — Installed
  ✓ Storybook (React) — Installed
  ✓ React — Installed
  ✓ Figma MCP Bridge — Configured
  ✓ designqa.config.ts — Found
  ✓ Claude Skill (design-qa) — Registered
  ✓ Design Tokens CSS — src/styles/tokens.css found

All required tools are ready!
```

### Figma MCP Bridge setup

Create a `.mcp.json` file at the project root (or parent directory):

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "npx",
      "args": ["-y", "@gethopp/figma-mcp-bridge"]
    }
  }
}
```

> Figma desktop app must be running. No API token is required.

## Usage

### 1. Register Figma mappings

Add story-to-Figma node mappings in `src/stories/designQa.ts`:

```ts
export const DESIGN_QA_REGISTRY = {
  "Pages/HomePage.Default": {
    key: "Pages/HomePage.Default",
    title: "Pages/HomePage",
    exportName: "Default",
    figmaNodeId: "3366:255",  // node-id from Figma URL (hyphen -> colon)
    figmaUrl: "https://www.figma.com/design/...",
    sourcePath: "src/pages/HomePage.stories.tsx",
  },
} as const satisfies Record<string, DesignQaEntry>;
```

### 2. Wrap stories

```tsx
import { withRegisteredDesignQaStory } from "../stories/designQa";

export const Default: Story = withRegisteredDesignQaStory("Pages/HomePage.Default", {
  name: "Home",
  render: () => <HomePage />,
});
```

### 3. Run QA in Claude Code

```bash
/design-qa HomePage      # Single component QA
/design-qa LoginPage     # Another component
/design-qa all           # All registered pages
```

## How it works

```
/design-qa HomePage
    |
    ├─ 1. Read designqa.config.ts (tokens path, registry path)
    ├─ 2. Look up Figma node ID from designQa.ts registry
    ├─ 3. Extract design spec via Figma MCP Bridge (spacing, color, typography)
    ├─ 4. Compare code vs Figma -> mismatch list (Spec/Visual/State)
    ├─ 5. Auto-fix high severity mismatches
    ├─ 6. Verify rendering via Storybook + agent-browser
    └─ 7. Pass/fail verdict (loop if needed)
```

## API

### Storybook helpers

```ts
import { withDesignQaStory, toStorybookId } from "@emperorhan/design-qa/storybook";
import type { DesignQaEntry } from "@emperorhan/design-qa/storybook";
```

### Config type

```ts
import type { DesignQaConfig } from "@emperorhan/design-qa/config";
```

## Team Guide

See [TEAM_GUIDE.md](./TEAM_GUIDE.md) for a step-by-step daily workflow guide to share with your team.

## License

MIT
