import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadDesignQaConfig, type LoadedDesignQaConfig } from "./config";
import { fetchMcpScreenshotToCache, probeMcpBridge } from "./mcp-bridge";
import { countPixelDiff, decodePng, resizeNearestNeighbor } from "./png-fallback";
import { getDesignSourceType, toStorybookId, type DesignQaEntry } from "./storybook";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type DecodedPngLike = {
  width: number;
  height: number;
  data: Uint8Array;
};

type PngTools = {
  pixelmatch: (
    img1: Uint8Array,
    img2: Uint8Array,
    output: Uint8Array,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ) => number;
  PNG: {
    sync: {
      read(buffer: Buffer): DecodedPngLike;
      write?: (png: { width: number; height: number; data: Uint8Array }) => Buffer;
    };
  };
  resize: (
    data: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ) => Uint8Array;
  supportsDiffImage: boolean;
};

export async function loadRuntimeConfig(cwd = process.cwd()) {
  const config = await loadDesignQaConfig(cwd);
  const reportRoot = path.resolve(cwd, config.reportDir);
  const reportRunsDir = path.join(reportRoot, "runs");
  const mcpCacheDir = path.join(reportRoot, "figma-mcp");
  const irPath = path.resolve(cwd, config.irFile);
  const evalReportPath = path.resolve(cwd, config.evalReportFile);
  const fixPromptPath = path.resolve(cwd, config.fixPromptFile);
  const generationDir = path.resolve(cwd, config.generation.outDir);
  const semanticEvalOutputPath = path.resolve(cwd, config.evaluation.semantic.outputFile);
  const semanticEvalInputPath = path.join(reportRoot, "semantic-eval.input.json");
  const semanticEvalPromptPath = path.join(reportRoot, "semantic-eval-prompt.md");
  const datasetValidationJsonPath = path.join(reportRoot, "dataset-validation.json");
  const datasetValidationMarkdownPath = path.join(reportRoot, "dataset-validation.md");
  const datasetFixJsonPath = path.join(reportRoot, "dataset-fix.json");
  const datasetFixPromptPath = path.join(reportRoot, "dataset-fix-prompt.md");
  const patchPlanPath = path.join(reportRoot, "patch-plan.json");
  const patchPromptPath = path.join(reportRoot, "patch-prompt.md");

  return {
    config,
    cwd,
    reportRoot,
    reportRunsDir,
    mcpCacheDir,
    irPath,
    evalReportPath,
    fixPromptPath,
    generationDir,
    semanticEvalInputPath,
    semanticEvalOutputPath,
    semanticEvalPromptPath,
    datasetValidationJsonPath,
    datasetValidationMarkdownPath,
    datasetFixJsonPath,
    datasetFixPromptPath,
    patchPlanPath,
    patchPromptPath,
  };
}

export function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function listDesignQaEntries(config: LoadedDesignQaConfig, keys?: string[]): DesignQaEntry[] {
  const all = Object.values(config.registry);
  if (!keys || keys.length === 0) {
    return all;
  }
  return keys.map((key) => {
    const entry = config.registry[key];
    if (!entry) {
      throw new Error(`Unknown design QA registry key: ${key}`);
    }
    return entry;
  });
}

export function getDesignQaEntryByKey(config: LoadedDesignQaConfig, key: string) {
  return config.registry[key] ?? null;
}

export function getStoryIframeUrl(storybookUrl: string, entry: DesignQaEntry) {
  const storyId = toStorybookId(entry.title, entry.exportName);
  return `${storybookUrl}/iframe.html?id=${storyId}&viewMode=story`;
}

export function hasStoryRenderError(content: string) {
  const normalized = content.toLowerCase();
  return (
    normalized.includes("enoent") ||
    normalized.includes("cannot find module") ||
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("error loading") ||
    normalized.includes("failed to load")
  );
}

export function getAgentBrowserEnv(cwd = process.cwd()) {
  const homeDir = path.join(cwd, ".design-qa", "agent-browser-home");
  const originalHomeDir = process.env.HOME ?? homeDir;
  const configDir = path.join(homeDir, ".agent-browser");
  const cacheDir = path.join(homeDir, ".cache");
  const stateDir = path.join(homeDir, ".local", "state");
  const socketDir = path.join(cwd, ".ab");
  const playwrightBrowsersPath = path.join(originalHomeDir, "Library", "Caches", "ms-playwright");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true });

  return {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_CACHE_HOME: cacheDir,
    XDG_STATE_HOME: stateDir,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
  };
}

export function createAgentBrowserSessionName(seed: string) {
  const digest = createHash("sha1").update(seed).digest("hex").slice(0, 10);
  return `dq-${digest}`;
}

export function probeStoryRender(iframeUrl: string, cwd = process.cwd()) {
  const probeSession = createAgentBrowserSessionName(`story:${iframeUrl}:${Date.now()}`);
  const openResult = spawnSync("agent-browser", ["--json", "--session", probeSession, "open", iframeUrl], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: getAgentBrowserEnv(cwd),
  });
  if (openResult.status !== 0) {
    const detail = openResult.stderr?.trim() || openResult.stdout?.trim() || "agent-browser_open_failed";
    spawnSync("agent-browser", ["--json", "--session", probeSession, "close"], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: getAgentBrowserEnv(cwd),
    });
    return { ok: false, error: detail };
  }

  const evalResult = spawnSync(
    "agent-browser",
    [
      "--json",
      "--session",
      probeSession,
      "eval",
      "JSON.stringify({text:document.body.innerText.slice(0,1000), html:document.body.innerHTML.slice(0,1000)})",
    ],
    {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: getAgentBrowserEnv(cwd),
    },
  );
  spawnSync("agent-browser", ["--json", "--session", probeSession, "close"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: getAgentBrowserEnv(cwd),
  });

  if (evalResult.status !== 0) {
    return { ok: false, error: "agent-browser_eval_failed" };
  }

  try {
    const parsed = JSON.parse(evalResult.stdout) as {
      success: boolean;
      data?: { result?: string };
    };
    const resultRaw = parsed.data?.result;
    if (!parsed.success || !resultRaw) {
      return { ok: false, error: "story_probe_parse_failed" };
    }
    const result = JSON.parse(resultRaw) as { text?: string; html?: string };
    const combined = `${result.text ?? ""}\n${result.html ?? ""}`;
    if (hasStoryRenderError(combined)) {
      return { ok: false, error: combined.trim().slice(0, 500) };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "story_probe_parse_failed" };
  }
}

export function relativeToCwd(cwd: string, filePath: string) {
  return path.relative(cwd, filePath).replaceAll(path.sep, "/");
}

export function resolveFromCwd(cwd: string, relativePath: string) {
  return path.join(cwd, relativePath);
}

export function resolveReferenceAsset(
  cwd: string,
  reportRoot: string,
  entry: DesignQaEntry,
) {
  const sources: Array<{ type: "mcp" | "cache" | "ref"; path: string }> = [];
  if (entry.figmaNodeId) {
    const sanitizedNodeId = entry.figmaNodeId.replaceAll(":", "-");
    const mcpImagePath = path.join(reportRoot, "figma-mcp", "images", `${sanitizedNodeId}.png`);
    if (fs.existsSync(mcpImagePath)) {
      sources.push({ type: "mcp", path: mcpImagePath });
    }

    const figmaSyncImagePath = path.join(cwd, "src", "figma-sync", "screens", `${sanitizedNodeId}.png`);
    if (fs.existsSync(figmaSyncImagePath)) {
      sources.push({ type: "cache", path: figmaSyncImagePath });
    }
  }

  if (entry.screenshotPath) {
    const screenshotPath = resolveFromCwd(cwd, entry.screenshotPath);
    if (fs.existsSync(screenshotPath)) {
      sources.push({ type: "ref", path: screenshotPath });
    }
  }

  if (entry.referencePath) {
    const refPath = resolveFromCwd(cwd, entry.referencePath);
    if (fs.existsSync(refPath)) {
      sources.push({ type: "ref", path: refPath });
    }
  }

  return sources[0] ?? null;
}

export async function resolveReferenceAssetWithMcp(
  cwd: string,
  reportRoot: string,
  entry: DesignQaEntry,
) {
  const mcpImageDir = path.join(reportRoot, "figma-mcp", "images");
  if (entry.figmaNodeId && getDesignSourceType(entry) !== "screenshot") {
    try {
      const bridge = await probeMcpBridge();
      if (bridge.ok) {
        const mcpPath = await fetchMcpScreenshotToCache({
          nodeId: entry.figmaNodeId,
          cacheDir: mcpImageDir,
        });
        return { type: "mcp" as const, path: mcpPath };
      }
    } catch {
      // Fall through to cached references.
    }
  }

  return resolveReferenceAsset(cwd, reportRoot, entry);
}

export function extractNodeIdFromFigmaUrl(figmaUrl: string) {
  const match = figmaUrl.match(/[?&]node-id=([0-9]+)-([0-9]+)/);
  if (!match) {
    return null;
  }
  return `${match[1]}:${match[2]}`;
}

export async function ensureStorybookServer(storybookUrl: string, cwd = process.cwd()) {
  if (await isStorybookReachable(storybookUrl)) {
    return { started: false as const };
  }

  const child = spawn("pnpm", ["storybook", "--host", "127.0.0.1", "--ci", "--quiet"], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const reachable = await waitForStorybook(storybookUrl, 60_000);
  if (!reachable) {
    return { started: false as const, degraded: true as const };
  }

  return { started: true as const };
}

export async function isStorybookReachable(storybookUrl: string, cwd = process.cwd()) {
  const curlResult = spawnSync("curl", ["-sfL", "--max-time", "5", storybookUrl], {
    encoding: "utf-8",
  });
  if (curlResult.status === 0) {
    return true;
  }

  try {
    const res = await fetch(storybookUrl);
    if (res.ok) {
      return true;
    }
  } catch {
    // Fall through to agent-browser probe.
  }

  const probeSession = createAgentBrowserSessionName(`probe:${storybookUrl}:${Date.now()}`);
  const openResult = spawnSync("agent-browser", ["--json", "--session", probeSession, "open", storybookUrl], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: getAgentBrowserEnv(cwd),
  });
  spawnSync("agent-browser", ["--json", "--session", probeSession, "close"], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: getAgentBrowserEnv(cwd),
  });
  return openResult.status === 0;
}

export async function waitForStorybook(storybookUrl: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isStorybookReachable(storybookUrl, process.cwd())) {
      return true;
    }
    await sleep(1_000);
  }
  return false;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadPngTools(): Promise<PngTools> {
  const require = createRequire(import.meta.url);
  const searchPaths = [__dirname, process.cwd(), path.join(process.cwd(), "node_modules")];
  try {
    const pixelmatchPath = require.resolve("pixelmatch", { paths: searchPaths });
    const pngjsPath = require.resolve("pngjs", { paths: searchPaths });
    const pixelmatchModule = await import(pathToFileURL(pixelmatchPath).href);
    const pngjsModule = await import(pathToFileURL(pngjsPath).href);

    return {
      pixelmatch: pixelmatchModule.default as (
        img1: Uint8Array,
        img2: Uint8Array,
        output: Uint8Array,
        width: number,
        height: number,
        options?: Record<string, unknown>,
      ) => number,
      PNG: pngjsModule.PNG as {
        sync: {
          read(buffer: Buffer): {
            width: number;
            height: number;
            data: Uint8Array;
          };
          write(png: { width: number; height: number; data: Uint8Array }): Buffer;
        };
      },
      resize: (
        data: Uint8Array,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number,
      ) => resizeNearestNeighbor(data, sourceWidth, sourceHeight, targetWidth, targetHeight),
      supportsDiffImage: true,
    } satisfies PngTools;
  } catch {
    return {
      pixelmatch: (
        img1: Uint8Array,
        img2: Uint8Array,
        _output: Uint8Array,
        width: number,
        height: number,
        options?: Record<string, unknown>,
      ) => countPixelDiff(img1, img2, width, height, { threshold: Number(options?.threshold ?? 0.1) }),
      PNG: {
        sync: {
          read(buffer: Buffer) {
            return decodePng(buffer);
          },
        },
      },
      resize: (
        data: Uint8Array,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number,
      ) => resizeNearestNeighbor(data, sourceWidth, sourceHeight, targetWidth, targetHeight),
      supportsDiffImage: false,
    } satisfies PngTools;
  }
}

export function createRunDir(reportRunsDir: string, label: string) {
  ensureDir(reportRunsDir);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const runDir = path.join(reportRunsDir, `${timestamp}-${label}`);
  ensureDir(runDir);
  return runDir;
}

export function getChangedFiles(cwd = process.cwd()) {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD", "--", "src"], {
    cwd,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    return new Set<string>();
  }
  return new Set(
    result.stdout
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean),
  );
}

export function sanitizeDirName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
