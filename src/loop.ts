import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createAgentBrowserSessionName,
  createRunDir,
  ensureStorybookServer,
  getAgentBrowserEnv,
  getChangedFiles,
  getStoryIframeUrl,
  hasStoryRenderError,
  listDesignQaEntries,
  loadPngTools,
  loadRuntimeConfig,
  relativeToCwd,
  resolveReferenceAssetWithMcp,
  sanitizeDirName,
} from "./node";
import type { DesignQaEntry } from "./storybook";
import { validateStories } from "./validate";

interface AgentBrowserResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
}

interface IterationReport {
  iteration: number;
  score: number;
  passed: boolean;
  criticalViolations: string[];
  metrics: {
    overflowCount: number;
    overflowElements?: Array<{
      selector: string;
      widthOverflow: number;
      heightOverflow: number;
    }>;
    dimensionMismatch: number;
    pixelDiffRatio: number | null;
    screenshotPath: string;
    diffPath?: string;
    referencePath?: string;
    runner: "agent-browser";
  };
}

interface StoryReport {
  entryKey: string;
  title: string;
  exportName: string;
  figmaNodeId?: string;
  iframeUrl: string;
  passed: boolean;
  finalScore: number;
  iterations: IterationReport[];
}

export async function runDesignLoop(args: string[], cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const { config, reportRoot, reportRunsDir } = runtime;

  if (args.includes("--report-only")) {
    return printLatestSummary(reportRoot);
  }

  await validateStories(cwd);

  const maxIterations = getNumberArg(args, "--max-iterations") ?? 5;
  const threshold = getNumberArg(args, "--threshold") ?? config.threshold;
  const filter = getStringArg(args, "--story");
  const changedOnly = args.includes("--changed");
  const autofixCommand = process.env.DESIGN_LOOP_AUTOFIX_CMD;

  let entries = listDesignQaEntries(config);
  if (filter) {
    entries = entries.filter((entry) =>
      `${entry.key} ${entry.title} ${entry.exportName}`.toLowerCase().includes(filter.toLowerCase()),
    );
  }
  if (changedOnly) {
    const changedFiles = getChangedFiles(cwd);
    entries = entries.filter((entry) => changedFiles.has(entry.sourcePath));
  }

  if (entries.length === 0) {
    throw new Error("No design QA stories matched the current filters");
  }

  await ensureStorybookServer(config.storybookUrl, cwd);

  const runDir = createRunDir(reportRunsDir, "design-loop");
  const storyReports: StoryReport[] = [];

  for (const entry of entries) {
    const report = await evaluateStory({
      entry,
      runDir,
      threshold,
      maxIterations,
      autofixCommand,
      cwd,
      reportRoot,
      storybookUrl: config.storybookUrl,
    });
    storyReports.push(report);
  }

  const summary = {
    storybookUrl: config.storybookUrl,
    runDir: relativeToCwd(cwd, runDir),
    threshold,
    totalStories: storyReports.length,
    passedStories: storyReports.filter((story) => story.passed).map((story) => story.entryKey),
    failedStories: storyReports.filter((story) => !story.passed).map((story) => story.entryKey),
    stories: storyReports,
  };

  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportRoot, "latest-summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.md"), renderSummary(summary));
  fs.writeFileSync(path.join(reportRoot, "latest-summary.md"), renderSummary(summary));

  return renderSummary(summary);
}

async function evaluateStory({
  entry,
  runDir,
  threshold,
  maxIterations,
  autofixCommand,
  cwd,
  reportRoot,
  storybookUrl,
}: {
  entry: DesignQaEntry;
  runDir: string;
  threshold: number;
  maxIterations: number;
  autofixCommand?: string;
  cwd: string;
  reportRoot: string;
  storybookUrl: string;
}) {
  const storyDir = path.join(runDir, sanitizeDirName(entry.key));
  fs.mkdirSync(storyDir, { recursive: true });

  const reference = await resolveReferenceAssetWithMcp(cwd, reportRoot, entry);
  const iframeUrl = getStoryIframeUrl(storybookUrl, entry);
  const session = createAgentBrowserSessionName(entry.key);
  const iterations: IterationReport[] = [];

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const screenshotPath = path.join(storyDir, `iteration-${iteration}.png`);
      const report = await captureIteration({
        entry,
        iframeUrl,
        session,
        screenshotPath,
        referencePath: reference?.path,
        iteration,
        threshold,
        cwd,
      });
      iterations.push(report);
      fs.writeFileSync(path.join(storyDir, `iteration-${iteration}.json`), JSON.stringify(report, null, 2));

      if (report.passed) break;
      if (!autofixCommand || iteration === maxIterations) break;

      runAutofix(autofixCommand, entry, path.join(storyDir, `iteration-${iteration}.json`), cwd);
    }
  } finally {
    runAgentBrowser(session, ["close"], cwd, false);
  }

  const finalIteration = iterations.at(-1)!;
  return {
    entryKey: entry.key,
    title: entry.title,
    exportName: entry.exportName,
    figmaNodeId: entry.figmaNodeId,
    iframeUrl,
    passed: finalIteration.passed && finalIteration.score >= threshold,
    finalScore: finalIteration.score,
    iterations,
  };
}

async function captureIteration({
  entry,
  iframeUrl,
  session,
  screenshotPath,
  referencePath,
  iteration,
  threshold,
  cwd,
}: {
  entry: DesignQaEntry;
  iframeUrl: string;
  session: string;
  screenshotPath: string;
  referencePath?: string;
  iteration: number;
  threshold: number;
  cwd: string;
}): Promise<IterationReport> {
  const viewport = entry.viewport ?? { width: 1440, height: 1024 };
  runAgentBrowser(session, ["set", "viewport", String(viewport.width), String(viewport.height)], cwd);
  runAgentBrowser(session, ["open", iframeUrl], cwd);
  runAgentBrowser(session, ["wait", "1500"], cwd);
  const renderProbe = runAgentBrowser<{ result: string }>(
    session,
    [
      "eval",
      "JSON.stringify({text:document.body.innerText.slice(0,1000), html:document.body.innerHTML.slice(0,1000)})",
    ],
    cwd,
  );
  const renderSnapshot = parseJsonResult<{ text?: string; html?: string }>(renderProbe.data.result, {});
  const renderText = `${renderSnapshot.text ?? ""}\n${renderSnapshot.html ?? ""}`;
  if (hasStoryRenderError(renderText)) {
    return {
      iteration,
      score: 0,
      passed: false,
      criticalViolations: ["storybook_render_error"],
      metrics: {
        overflowCount: 0,
        overflowElements: [],
        dimensionMismatch: 0,
        pixelDiffRatio: null,
        screenshotPath: relativeToCwd(cwd, screenshotPath),
        referencePath: referencePath ? relativeToCwd(cwd, referencePath) : undefined,
        runner: "agent-browser",
      },
    };
  }

  runAgentBrowser(session, [
    "eval",
    "document.documentElement.style.setProperty('caret-color','transparent');const style=document.createElement('style');style.innerHTML='*{animation:none !important; transition:none !important;}';document.head.appendChild(style);JSON.stringify({ready:true});",
  ], cwd);
  runAgentBrowser(session, ["wait", "250"], cwd);
  runAgentBrowser(session, ["screenshot", screenshotPath], cwd);

  const overflowResponse = runAgentBrowser<{ result: string }>(
    session,
    [
      "eval",
      "JSON.stringify(Array.from(document.querySelectorAll('body *')).map((element)=>{const node=element;const style=window.getComputedStyle(node);const tag=node.tagName.toLowerCase();const widthOverflow=node.scrollWidth-node.clientWidth;const heightOverflow=node.scrollHeight-node.clientHeight;const id=node.id ? '#' + node.id : '';const classNames=node.className ? '.' + String(node.className).split(/\\s+/).filter(Boolean).slice(0,2).join('.') : '';return {tag,selector:tag+id+classNames,display:style.display,visibility:style.visibility,widthOverflow,heightOverflow};}).filter((entry)=>{if(entry.display==='inline'||entry.visibility==='hidden') return false;if(['input','button','svg','path'].includes(entry.tag)) return false;return entry.widthOverflow>10||entry.heightOverflow>10;}).slice(0,20))",
    ],
    cwd,
  );

  const overflowElements = parseJsonResult<
    Array<{ selector: string; widthOverflow: number; heightOverflow: number }>
  >(overflowResponse.data.result, []);
  let score = 100;
  const criticalViolations: string[] = [];
  let dimensionMismatch = 0;
  let pixelDiffRatio: number | null = null;
  let diffPath: string | undefined;

  if (!referencePath) {
    criticalViolations.push("missing_reference_asset");
    score = 0;
  } else {
    const { pixelmatch, PNG, resize, supportsDiffImage } = await loadPngTools();
    const screenshot = PNG.sync.read(fs.readFileSync(screenshotPath));
    const reference = PNG.sync.read(fs.readFileSync(referencePath));

    let comparisonReference = reference;
    if (screenshot.width !== reference.width || screenshot.height !== reference.height) {
      const aspectDelta = Math.abs(screenshot.width / screenshot.height - reference.width / reference.height);
      if (aspectDelta < 0.01) {
        comparisonReference = {
          width: screenshot.width,
          height: screenshot.height,
          data: resize(reference.data, reference.width, reference.height, screenshot.width, screenshot.height),
        };
      } else {
        const widthDelta = Math.abs(screenshot.width - reference.width) / Math.max(reference.width, 1);
        const heightDelta = Math.abs(screenshot.height - reference.height) / Math.max(reference.height, 1);
        dimensionMismatch = Number((widthDelta + heightDelta).toFixed(4));
        score -= Math.min(20, Math.round(dimensionMismatch * 100));
      }
    }

    if (dimensionMismatch === 0) {
      const diff = { width: screenshot.width, height: screenshot.height, data: new Uint8Array(screenshot.data.length) };
      const diffPixels = pixelmatch(
        screenshot.data,
        comparisonReference.data,
        diff.data,
        screenshot.width,
        screenshot.height,
        { threshold: 0.1 },
      );
      pixelDiffRatio = diffPixels / (screenshot.width * screenshot.height);
      if (supportsDiffImage && "write" in PNG.sync && typeof PNG.sync.write === "function") {
        diffPath = screenshotPath.replace(/\.png$/, ".diff.png");
        fs.writeFileSync(diffPath, PNG.sync.write(diff));
      }

      if (pixelDiffRatio > 0.2) score -= 30;
      else if (pixelDiffRatio > 0.1) score -= 20;
      else if (pixelDiffRatio > 0.05) score -= 10;
      else if (pixelDiffRatio > 0.02) score -= 5;
    }
  }

  if (overflowElements.length > 0) {
    criticalViolations.push("overflow_detected");
    score -= 40;
  }

  score = Math.max(0, score);

  return {
    iteration,
    score,
    passed: score >= threshold && criticalViolations.length === 0,
    criticalViolations,
    metrics: {
      overflowCount: overflowElements.length,
      overflowElements,
      dimensionMismatch,
      pixelDiffRatio,
      screenshotPath: relativeToCwd(cwd, screenshotPath),
      diffPath: diffPath ? relativeToCwd(cwd, diffPath) : undefined,
      referencePath: referencePath ? relativeToCwd(cwd, referencePath) : undefined,
      runner: "agent-browser",
    },
  };
}

function runAgentBrowser<T = Record<string, unknown>>(
  session: string,
  args: string[],
  cwd: string,
  throwOnError?: true,
): AgentBrowserResponse<T>;
function runAgentBrowser<T = Record<string, unknown>>(
  session: string,
  args: string[],
  cwd: string,
  throwOnError: false,
): AgentBrowserResponse<T> | null;
function runAgentBrowser<T = Record<string, unknown>>(
  session: string,
  args: string[],
  cwd: string,
  throwOnError = true,
) {
  const result = spawnSync("agent-browser", ["--session", session, "--json", ...args], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: getAgentBrowserEnv(cwd),
  });

  if (result.status !== 0) {
    if (throwOnError) {
      throw new Error(`agent-browser failed: ${result.stderr || result.stdout}`);
    }
    return null;
  }

  const parsed = JSON.parse(result.stdout) as AgentBrowserResponse<T>;
  if (!parsed.success && throwOnError) {
    throw new Error(`agent-browser command failed: ${parsed.error ?? "unknown error"}`);
  }
  return parsed;
}

function runAutofix(command: string, entry: DesignQaEntry, reportPath: string, cwd: string) {
  const result = spawnSync("sh", ["-lc", command], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      DESIGN_QA_ENTRY_KEY: entry.key,
      DESIGN_QA_SOURCE_PATH: entry.sourcePath,
      DESIGN_QA_REPORT_PATH: reportPath,
    },
  });
  if (result.status !== 0) {
    throw new Error(`Autofix command failed for ${entry.key}`);
  }
}

function renderSummary(summary: {
  runDir: string;
  totalStories: number;
  passedStories: string[];
  failedStories: string[];
  stories: StoryReport[];
}) {
  const lines = [
    "# Design QA Summary",
    "",
    `- Run dir: ${summary.runDir}`,
    `- Total stories: ${summary.totalStories}`,
    `- Passed: ${summary.passedStories.length}`,
    `- Failed: ${summary.failedStories.length}`,
    "",
    "## Results",
  ];
  for (const story of summary.stories) {
    lines.push(`- ${story.entryKey}: ${story.finalScore}/100 ${story.passed ? "PASS" : "FAIL"}`);
  }
  return `${lines.join("\n")}\n`;
}

function printLatestSummary(reportRoot: string) {
  const latestSummary = path.join(reportRoot, "latest-summary.md");
  if (!fs.existsSync(latestSummary)) {
    throw new Error("No design QA summary found. Run design-qa loop first.");
  }
  return fs.readFileSync(latestSummary, "utf-8");
}

function parseJsonResult<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getStringArg(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function getNumberArg(args: string[], flag: string) {
  const value = getStringArg(args, flag);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} expects a numeric value`);
  }
  return parsed;
}
