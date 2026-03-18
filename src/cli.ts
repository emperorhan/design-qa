import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMANDS = ["init", "doctor", "help"] as const;
type Command = (typeof COMMANDS)[number];

// ── Colors for terminal output ──
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    console.log(pkg.version);
    process.exit(0);
  }

  const command = (args[0] ?? "help") as Command;

  switch (command) {
    case "init":
      process.exit(init(args.slice(1)));
      break;
    case "doctor":
      process.exit(doctor(args.slice(1)));
      break;
    case "help":
    default:
      return help();
  }
}

// ── help ──

function help() {
  console.log(`
${BOLD}@emperorhan/design-qa${RESET} — Figma → Storybook Design QA toolkit for Claude Code

${BOLD}Usage:${RESET}
  npx @emperorhan/design-qa init [options]    Initialize design-qa in a project
  npx @emperorhan/design-qa doctor            Check required tools and configuration
  npx @emperorhan/design-qa help              Show this help
  npx @emperorhan/design-qa --version         Show version

${BOLD}init options:${RESET}
  --dir <path>       Project directory (default: current directory)
  --tokens <path>    Path to CSS tokens file (default: src/styles/tokens.css)
  --skip-doctor      Skip prerequisite check after init
  --force            Overwrite existing files
`);
}

// ── doctor: check prerequisites ──

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  fix?: string;
}

function checkCommand(name: string, cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkNpmPackage(pkg: string, dir: string): boolean {
  try {
    const pkgJsonPath = path.join(dir, "node_modules", ...pkg.split("/"), "package.json");
    return fs.existsSync(pkgJsonPath);
  } catch {
    return false;
  }
}

function runChecks(projectDir: string): CheckResult[] {
  const results: CheckResult[] = [];

  // 1. Claude Code
  const hasClaude = checkCommand("claude", "claude");
  results.push({
    name: "Claude Code",
    status: hasClaude ? "pass" : "fail",
    message: hasClaude ? "Installed" : "Claude Code is not installed",
    fix: "Install from https://claude.ai/claude-code",
  });

  // 2. agent-browser
  const hasAgentBrowser = checkCommand("agent-browser", "agent-browser");
  results.push({
    name: "agent-browser",
    status: hasAgentBrowser ? "pass" : "fail",
    message: hasAgentBrowser ? "Installed" : "agent-browser is not installed",
    fix: "npm install -g @anthropic-ai/agent-browser",
  });

  // 3. Storybook (React)
  const hasStorybook =
    checkNpmPackage("@storybook/react-vite", projectDir) ||
    checkNpmPackage("@storybook/react-webpack5", projectDir) ||
    checkNpmPackage("@storybook/react", projectDir);
  results.push({
    name: "Storybook (React)",
    status: hasStorybook ? "pass" : "fail",
    message: hasStorybook ? "Installed" : "Storybook React framework is not installed",
    fix: "npx storybook@latest init --type react",
  });

  // 4. React
  const hasReact = checkNpmPackage("react", projectDir);
  results.push({
    name: "React",
    status: hasReact ? "pass" : "fail",
    message: hasReact ? "Installed" : "React is not installed",
    fix: "npm install react react-dom",
  });

  // 5. Figma MCP Bridge
  const mcpJsonPath = findMcpJson(projectDir);
  let hasFigmaMcp = false;
  if (mcpJsonPath) {
    try {
      const mcpContent = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
      const servers = mcpContent.mcpServers ?? mcpContent.servers ?? {};
      hasFigmaMcp = Object.keys(servers).some(
        (key) => key.includes("figma") || key.includes("Figma"),
      );
    } catch {
      // ignore parse errors
    }
  }
  results.push({
    name: "Figma MCP Bridge",
    status: hasFigmaMcp ? "pass" : "warn",
    message: hasFigmaMcp
      ? "Configured"
      : "Figma MCP server not configured in .mcp.json (live Figma integration unavailable)",
    fix: `Add figma-bridge MCP server to .mcp.json (no token required):
{
  "mcpServers": {
    "figma-bridge": {
      "command": "npx",
      "args": ["-y", "@gethopp/figma-mcp-bridge"]
    }
  }
}
Figma desktop app must be running. See: https://github.com/gethopp/figma-mcp-bridge`,
  });

  // 6. designqa.config.ts
  const hasConfig = fs.existsSync(path.join(projectDir, "designqa.config.ts"));
  results.push({
    name: "designqa.config.ts",
    status: hasConfig ? "pass" : "warn",
    message: hasConfig ? "Found" : "Config file not found",
    fix: "npx @emperorhan/design-qa init",
  });

  // 7. Claude Skill
  const hasSkill = fs.existsSync(path.join(projectDir, ".claude/skills/design-qa/SKILL.md"));
  results.push({
    name: "Claude Skill (design-qa)",
    status: hasSkill ? "pass" : "warn",
    message: hasSkill ? "Registered" : "Claude skill not registered",
    fix: "npx @emperorhan/design-qa init",
  });

  // 8. Design tokens file
  const configPath = path.join(projectDir, "designqa.config.ts");
  if (hasConfig) {
    // Try to read tokensPath from config (basic regex parse)
    const configContent = fs.readFileSync(configPath, "utf-8");
    const tokensMatch = configContent.match(/tokensPath:\s*["']([^"']+)["']/);
    const tokensPath = tokensMatch?.[1] ?? "src/styles/tokens.css";
    const hasTokens = fs.existsSync(path.join(projectDir, tokensPath));
    results.push({
      name: "Design Tokens CSS",
      status: hasTokens ? "pass" : "warn",
      message: hasTokens ? `${tokensPath} found` : `${tokensPath} not found`,
      fix: `Create design tokens CSS file at ${tokensPath}`,
    });
  }

  return results;
}

function findMcpJson(projectDir: string): string | null {
  // Search up from project dir to find .mcp.json
  let dir = projectDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".mcp.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function doctor(args: string[]) {
  let projectDir = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      projectDir = path.resolve(args[++i]);
    }
  }

  console.log(`\n${BOLD}Design QA Doctor${RESET}`);
  console.log(`${DIM}Project: ${projectDir}${RESET}\n`);

  const results = runChecks(projectDir);

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const r of results) {
    const icon =
      r.status === "pass"
        ? `${GREEN}✓${RESET}`
        : r.status === "warn"
          ? `${YELLOW}!${RESET}`
          : `${RED}✗${RESET}`;
    const color = r.status === "pass" ? GREEN : r.status === "warn" ? YELLOW : RED;
    console.log(`  ${icon} ${BOLD}${r.name}${RESET} — ${color}${r.message}${RESET}`);
    if (r.status !== "pass" && r.fix) {
      console.log(`    ${DIM}-> ${r.fix}${RESET}`);
    }

    if (r.status === "pass") passCount++;
    else if (r.status === "warn") warnCount++;
    else failCount++;
  }

  console.log();
  if (failCount === 0) {
    console.log(`${GREEN}${BOLD}All required tools are ready!${RESET}`);
    if (warnCount > 0) {
      console.log(`${YELLOW}${DIM}   ${warnCount} recommended item(s) not configured.${RESET}`);
    }
  } else {
    console.log(`${RED}${BOLD}${failCount} required tool(s) missing.${RESET}`);
    console.log(`${DIM}   Follow the instructions above and run again.${RESET}`);
  }
  console.log();

  return failCount === 0 ? 0 : 1;
}

// ── init ──

function detectStorybookPackage(projectDir: string): string {
  if (checkNpmPackage("@storybook/react-vite", projectDir)) {
    return "@storybook/react-vite";
  }
  if (checkNpmPackage("@storybook/react-webpack5", projectDir)) {
    return "@storybook/react-webpack5";
  }
  return "@storybook/react";
}

function init(args: string[]): number {
  let projectDir = process.cwd();
  let tokensPath = "src/styles/tokens.css";
  let skipDoctor = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      projectDir = path.resolve(args[++i]);
    } else if (args[i] === "--tokens" && args[i + 1]) {
      tokensPath = args[++i];
    } else if (args[i] === "--skip-doctor") {
      skipDoctor = true;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  console.log(`\n${BOLD}Initializing design-qa${RESET}`);
  console.log(`${DIM}Project: ${projectDir}${RESET}\n`);

  // 1. designqa.config.ts
  const configContent = `import type { DesignQaConfig } from "@emperorhan/design-qa/config";

const config: DesignQaConfig = {
  storybookUrl: "http://localhost:6006",
  tokensPath: "${tokensPath}",
  srcRoot: "src",
  registryPath: "src/stories/designQa.ts",
  figmaRefsPath: "figma-refs",
};

export default config;
`;
  writeFile(path.join(projectDir, "designqa.config.ts"), configContent, force);

  // 2. Registry file — detect installed storybook package
  const sbPackage = detectStorybookPackage(projectDir);
  const registryContent = `import type { DesignQaEntry } from "@emperorhan/design-qa/storybook";
import { withDesignQaStory } from "@emperorhan/design-qa/storybook";
import type { StoryObj } from "${sbPackage}";

/**
 * Design QA Registry — Storybook story <-> Figma node mapping.
 *
 * Usage in stories:
 *   export const Default: Story = withRegisteredDesignQaStory("Pages/Home.Default", {
 *     render: () => <HomePage />,
 *   });
 */
export const DESIGN_QA_REGISTRY = {
  // "Pages/HomePage.Default": {
  //   key: "Pages/HomePage.Default",
  //   title: "Pages/HomePage",
  //   exportName: "Default",
  //   figmaNodeId: "1234:5678",
  //   figmaUrl: "https://www.figma.com/design/<fileKey>?node-id=1234-5678",
  //   sourcePath: "src/pages/HomePage.stories.tsx",
  // },
} as const satisfies Record<string, DesignQaEntry>;

export type DesignQaKey = keyof typeof DESIGN_QA_REGISTRY;

export function getDesignQaEntry(key: DesignQaKey): DesignQaEntry {
  return DESIGN_QA_REGISTRY[key];
}

export function withRegisteredDesignQaStory<TArgs>(
  key: DesignQaKey,
  story: StoryObj<TArgs>,
): StoryObj<TArgs> {
  return withDesignQaStory(getDesignQaEntry(key), story as never) as StoryObj<TArgs>;
}
`;
  const registryDir = path.join(projectDir, "src/stories");
  fs.mkdirSync(registryDir, { recursive: true });
  writeFile(path.join(registryDir, "designQa.ts"), registryContent, force);

  // 3. Claude Skill
  const skillDir = path.join(projectDir, ".claude/skills/design-qa");
  fs.mkdirSync(skillDir, { recursive: true });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const skillTemplatePath = path.join(__dirname, "../templates/SKILL.md");
  if (fs.existsSync(skillTemplatePath)) {
    const skillContent = fs.readFileSync(skillTemplatePath, "utf-8");
    writeFile(path.join(skillDir, "SKILL.md"), skillContent, force);
  } else {
    console.log(`  ${YELLOW}!${RESET} Skill template not found`);
  }

  // 4. figma-refs directory
  const figmaRefsDir = path.join(projectDir, "figma-refs");
  fs.mkdirSync(figmaRefsDir, { recursive: true });
  writeFile(path.join(figmaRefsDir, ".gitkeep"), "", force);

  console.log(`\n${GREEN}${BOLD}Design QA initialized!${RESET}\n`);

  // 5. Run doctor
  if (!skipDoctor) {
    console.log(`${DIM}--- Prerequisite check ---${RESET}\n`);
    doctor(["--dir", projectDir]);
  }

  console.log(`${BOLD}Next steps:${RESET}`);
  console.log(`  ${CYAN}1.${RESET} Add Figma mappings to src/stories/designQa.ts`);
  console.log(`  ${CYAN}2.${RESET} Use withRegisteredDesignQaStory() in your stories`);
  console.log(`  ${CYAN}3.${RESET} Run ${BOLD}/design-qa <Component>${RESET} in Claude Code`);
  console.log();

  return 0;
}

function writeFile(filePath: string, content: string, force = false) {
  const rel = path.relative(process.cwd(), filePath);
  if (fs.existsSync(filePath) && !force) {
    console.log(`  ${DIM}>> ${rel} (already exists, use --force to overwrite)${RESET}`);
    return;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  ${GREEN}+${RESET} ${rel}`);
}

main();
