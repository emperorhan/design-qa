# Design QA Team Guide

Claude Code + Figma + Storybook based design QA workflow.

## Setup (one-time)

### 1. Install tools

```bash
# agent-browser (screenshot QA)
npm install -g @anthropic-ai/agent-browser

# Install package in your project
pnpm add -D @emperorhan/design-qa

# Initialize (creates config, skill, registry)
npx @emperorhan/design-qa init

# Check prerequisites
npx @emperorhan/design-qa doctor
```

All items should be ✓:

```
  ✓ Claude Code
  ✓ agent-browser
  ✓ Storybook (React)
  ✓ React
  ✓ Figma MCP Bridge
  ✓ designqa.config.ts
  ✓ Claude Skill (design-qa)
  ✓ Design Tokens CSS
```

### 2. Figma MCP Bridge

Add to `.mcp.json` at project root (or parent directory). If the file already exists, add `figma-bridge` to the existing `mcpServers`:

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

> No API token required. Figma desktop app must be running.

---

## Daily Workflow

### Step 1. Prepare icons

Export SVG icons from Figma and save to your icons directory (e.g. `src/assets/icons/`).

> Claude auto-normalizes SVGs: removes width/height, converts fill to `currentColor`, ensures viewBox.

### Step 2. Open Figma desktop

1. Launch Figma desktop app
2. Open the design file
3. Select the page/frames to implement

### Step 3. Start Storybook

```bash
pnpm storybook
```

### Step 4. Run Design QA in Claude Code

```bash
# Start Claude Code (restart after first init to pick up the skill)
claude
```

#### Single page QA

```
/design-qa LoginPage
```

#### All pages sequentially

```
Figma의 모든 페이지에 대해서 순차적으로 design-qa 해줘
```

#### New page implementation + QA

```
Implement SettingsPage from Figma and run design-qa
```

---

## What Claude does

When you run `/design-qa`, Claude automatically:

1. **Extracts Figma spec** — reads spacing, color, typography via MCP Bridge
2. **Compares code** — finds mismatches between implementation and Figma
3. **Auto-fixes** — corrects high severity issues in code
4. **Verifies** — takes Storybook screenshots via agent-browser
5. **Reports** — outputs pass/fail with change summary

### Result format

```
### Plan
LoginPage YubiKey connected state QA

### Findings
**Spec mismatch**
- StatusBadge padding: 8px → 10px 16px

### Changes
- `src/components/StatusBadge.tsx` — fixed padding

### QA Result
**pass**

### Remaining Risk
None
```

---

## Adding new components

### 1. Find Figma node ID

From the Figma URL, find the `node-id` parameter:

```
https://www.figma.com/design/abc123/...?node-id=3366-255
                                                ^^^^^^^^
                                                3366:255 (hyphen → colon)
```

### 2. Register in designQa.ts

```ts
"Pages/NewPage.Default": {
  key: "Pages/NewPage.Default",
  title: "Pages/NewPage",
  exportName: "Default",
  figmaNodeId: "3366:255",
  figmaUrl: "https://www.figma.com/design/abc123/...?node-id=3366-255",
  sourcePath: "src/pages/NewPage.stories.tsx",
},
```

### 3. Wrap story

```tsx
export const Default: Story = withRegisteredDesignQaStory("Pages/NewPage.Default", {
  name: "Default state",
  render: () => <NewPage />,
});
```

### 4. Run QA

```
/design-qa NewPage
```

---

## Rules

| Rule | Description |
|------|-------------|
| Storybook first | Stories are the primary output; app integration is secondary |
| 1 story = 1 Figma node | Separate stories per state (Default, Error, Loading, etc.) |
| Use tokens | CSS variables from tokens file, no hardcoded values |
| Icons are manual | Export SVG from Figma → icons directory (Claude normalizes) |
| Figma app open | MCP Bridge connects to the desktop app directly |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't read Figma nodes | Check Figma desktop app is open |
| Storybook not accessible | Run `pnpm storybook` |
| agent-browser error | `npm i -g @anthropic-ai/agent-browser` |
| Skill not visible | Restart Claude Code after `init` |
| doctor fails | Run `npx @emperorhan/design-qa doctor` to see missing items |
