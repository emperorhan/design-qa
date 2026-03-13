import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { validateFigmaDataset } from "./figma-dataset";
import { loadIconDataset, validateIconDataset } from "./icons";
import { probeMcpBridge } from "./mcp-bridge";
import {
  detectStorybookFrameworkSupport,
  getStoryIframeUrl,
  isStorybookReachable,
  loadRuntimeConfig,
  probeStoryRender,
  resolveReferenceAsset,
} from "./node";
import { getDesignSourceType, isFixtureEntry } from "./storybook";

export async function runDoctor(cwd = process.cwd()) {
  const runtime = await loadRuntimeConfig(cwd);
  const {
    config,
    reportRoot,
    irPath,
    generationDir,
    evalReportPath,
    semanticEvalInputPath,
    semanticEvalOutputPath,
    semanticEvalPromptPath,
    datasetValidationJsonPath,
    datasetValidationMarkdownPath,
    datasetFixJsonPath,
    datasetFixPromptPath,
    patchPlanPath,
    patchPromptPath,
  } = runtime;
  const checks: Array<{ label: string; ok: boolean; detail: string; action?: string }> = [];
  const activeRegistryEntries = Object.values(config.registry).filter((entry) => !isFixtureEntry(entry));
  const fixtureRegistryEntries = Object.values(config.registry).filter((entry) => isFixtureEntry(entry));
  const collectionPlanPath = path.join(cwd, ".design-qa", "figma", "collection-plan.json");

  checks.push({
    label: "target-repo",
    ok: true,
    detail: cwd,
  });

  checks.push({
    label: "installation-model",
    ok: true,
    detail: "preferred: repo-local dependency with npx or package scripts; global install also supported",
  });

  checks.push({
    label: "node",
    ok: true,
    detail: process.version,
  });

  const tsxResult = safeSpawn("tsx", ["--version"], cwd);
  const bunResult = safeSpawn("bun", ["--version"], cwd);
  checks.push({
    label: "ts-runtime",
    ok: tsxResult.status === 0 || bunResult.status === 0,
    detail:
      tsxResult.status === 0
        ? `tsx ${tsxResult.stdout.trim()}`
        : bunResult.status === 0
          ? `bun ${bunResult.stdout.trim()}`
          : "missing tsx and bun",
    action: tsxResult.status === 0 || bunResult.status === 0 ? undefined : "install tsx or bun",
  });

  const agentBrowserResult = safeSpawn("agent-browser", ["--version"], cwd);
  checks.push({
    label: "agent-browser",
    ok: agentBrowserResult.status === 0,
    detail:
      agentBrowserResult.status === 0
        ? agentBrowserResult.stdout.trim() || "installed"
        : "missing from PATH",
    action: agentBrowserResult.status === 0 ? undefined : "install agent-browser and rerun doctor",
  });

  const configPath = path.join(cwd, "designqa.config.ts");
  checks.push({
    label: "config",
    ok: fs.existsSync(configPath),
    detail: fs.existsSync(configPath) ? "designqa.config.ts found" : "designqa.config.ts missing",
    action: fs.existsSync(configPath) ? undefined : "run design-qa init in the target frontend repo",
  });

  checks.push({
    label: "registry",
    ok: activeRegistryEntries.length > 0 || fixtureRegistryEntries.length > 0,
    detail:
      fixtureRegistryEntries.length > 0
        ? `${activeRegistryEntries.length} active registry entries, ${fixtureRegistryEntries.length} example fixture entries ignored`
        : `${activeRegistryEntries.length} registry entries`,
    action: activeRegistryEntries.length > 0 || fixtureRegistryEntries.length > 0 ? undefined : "populate src/stories/designQa.ts with at least one entry",
  });

  checks.push({
    label: "mode",
    ok: true,
    detail: config.mode,
  });

  const packageJsonPath = path.join(cwd, "package.json");
  const packageJson = fs.existsSync(packageJsonPath) ? JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown> : null;
  const packageScripts = packageJson && typeof packageJson.scripts === "object" ? (packageJson.scripts as Record<string, string>) : {};
  checks.push({
    label: "storybook-script",
    ok: Boolean(packageScripts.storybook),
    detail: packageScripts.storybook ? `storybook -> ${packageScripts.storybook}` : "package.json has no storybook script",
    action: packageScripts.storybook ? undefined : "add a working storybook script before running design-qa eval",
  });

  const storybookPackages = detectStorybookPackages(packageJson);
  checks.push({
    label: "storybook-packages",
    ok: storybookPackages.ok,
    detail: storybookPackages.detail,
    action: storybookPackages.ok ? undefined : "align Storybook package majors and install a supported React Storybook framework such as @storybook/react-vite",
  });

  const frameworkSupport = detectStorybookFrameworkSupport(cwd);
  checks.push({
    label: "react-storybook",
    ok: frameworkSupport.supported,
    detail: frameworkSupport.detail,
    action: frameworkSupport.supported ? undefined : frameworkSupport.action,
  });

  const bridge = await probeMcpBridge();
  const datasetValidation = validateFigmaDataset(cwd, config);
  checks.push({
    label: "figma-mcp-bridge",
    ok: bridge.ok || datasetValidation.errors.length === 0,
    detail:
      bridge.ok || datasetValidation.errors.length === 0
        ? bridge.ok
          ? `${bridge.detail} (legacy fallback available)`
          : "dataset available, live MCP fallback optional"
        : `${bridge.detail} (legacy fallback only)`,
    action: bridge.ok || datasetValidation.errors.length === 0 ? undefined : "prefer agent-prepared figma dataset; use MCP bridge only as a fallback",
  });

  const referenceCoverage = Object.values(config.registry).reduce(
    // Example fixture entries are ignored until replaced with real mappings.
    (acc: { withReference: number; missing: string[] }, entry) => {
      if (isFixtureEntry(entry)) return acc;
      const resolved = resolveReferenceAsset(cwd, reportRoot, entry);
      if (resolved) acc.withReference += 1;
      else acc.missing.push(entry.key);
      return acc;
    },
    { withReference: 0, missing: [] as string[] },
  );

  checks.push({
    label: "reference-assets",
    ok:
      referenceCoverage.missing.length === 0 ||
      bridge.ok ||
      Object.values(config.registry).every((entry) => getDesignSourceType(entry) !== "screenshot"),
    detail:
      referenceCoverage.missing.length === 0
        ? `${referenceCoverage.withReference}/${Object.keys(config.registry).length} stories ready`
        : bridge.ok
          ? `${referenceCoverage.withReference}/${Object.keys(config.registry).length} stories ready, missing: ${referenceCoverage.missing.join(", ")} (live MCP fallback available)`
          : `${referenceCoverage.withReference}/${Object.keys(config.registry).length} stories ready, missing: ${referenceCoverage.missing.join(", ")}`,
    action:
      referenceCoverage.missing.length === 0 || bridge.ok
        ? undefined
        : "add reference screenshots or provide a reachable Figma MCP source",
  });

  checks.push({
    label: "design-ir",
    ok: fs.existsSync(irPath),
    detail: fs.existsSync(irPath) ? "design-ir.json present" : "design-ir.json missing",
    action: fs.existsSync(irPath) ? undefined : "run design-qa ingest ...",
  });

  checks.push({
    label: "figma-dataset",
    ok: datasetValidation.errors.length === 0,
    detail: fs.existsSync(datasetValidation.dataset.rootDir)
      ? `${datasetValidation.report.registryNodeCoverage.covered}/${datasetValidation.report.registryNodeCoverage.total} registry nodes covered, ${datasetValidation.warnings.length} warnings`
      : ".design-qa/figma directory missing",
    action:
      datasetValidation.errors.length === 0
        ? undefined
        : "run design-qa validate-dataset, then design-qa dataset-fix or regenerate the dataset with Codex/Claude + native Figma MCP",
  });
  checks.push({
    label: "figma-source",
    ok: datasetValidation.report.sourceDetection.assetExportMode !== "remote-wrapper",
    detail: `${datasetValidation.report.sourceDetection.mcpSource} / ${datasetValidation.report.sourceDetection.assetExportMode}`,
    action:
      datasetValidation.report.sourceDetection.assetExportMode !== "remote-wrapper"
        ? undefined
        : "remote wrapper assets are not usable exports; recollect SVG assets with desktop MCP localhost export",
  });
  checks.push({
    label: "page-depth",
    ok: datasetValidation.report.sourceDetection.pageCollectionDepth !== "shallow",
    detail: datasetValidation.report.sourceDetection.pageCollectionDepth,
    action:
      datasetValidation.report.sourceDetection.pageCollectionDepth !== "shallow"
        ? undefined
        : "re-collect pages with nested or full-canvas node trees",
  });
  checks.push({
    label: "registry-placeholders",
    ok: datasetValidation.report.placeholderFixtureIssues.length === 0,
    detail:
      datasetValidation.report.placeholderFixtureIssues.length === 0
        ? "no placeholder registry ids detected"
        : datasetValidation.report.placeholderFixtureIssues.join("; "),
    action:
      datasetValidation.report.placeholderFixtureIssues.length === 0
        ? undefined
        : "replace placeholder fixture figmaNodeId values in the repo registry before treating this as a dataset failure",
  });

  const iconDataset = loadIconDataset(cwd);
  const iconDatasetValidation = validateIconDataset(cwd);
  checks.push({
    label: "icon-dataset",
    ok: iconDataset.icons.length === 0 || iconDatasetValidation.errors.length === 0,
    detail:
      iconDataset.icons.length === 0
        ? "no icons dataset found (optional)"
        : `${iconDataset.icons.length} icons in ${path.relative(cwd, iconDataset.datasetPath)}`,
    action:
      iconDataset.icons.length === 0 || iconDatasetValidation.errors.length === 0
        ? undefined
        : `fix icon dataset errors: ${iconDatasetValidation.errors.join("; ")}`,
  });

  checks.push({
    label: "generation-dir",
    ok: fs.existsSync(generationDir),
    detail: fs.existsSync(generationDir) ? path.relative(cwd, generationDir) : "generated Storybook scaffolds missing",
    action: fs.existsSync(generationDir) ? undefined : "run design-qa generate storybook",
  });

  checks.push({
    label: "semantic-eval",
    ok: config.evaluation.semantic.enabled,
    detail: config.evaluation.semantic.enabled
      ? `enabled (${config.evaluation.semantic.severityThreshold})`
      : "disabled",
  });

  checks.push({
    label: "eval-report",
    ok: fs.existsSync(evalReportPath),
    detail: fs.existsSync(evalReportPath) ? path.relative(cwd, evalReportPath) : "eval-report.json missing",
    action: fs.existsSync(evalReportPath) ? undefined : "run design-qa eval",
  });

  checks.push({
    label: "dataset-validation-report",
    ok: fs.existsSync(datasetValidationJsonPath) && fs.existsSync(datasetValidationMarkdownPath),
    detail:
      fs.existsSync(datasetValidationJsonPath) && fs.existsSync(datasetValidationMarkdownPath)
        ? `${path.relative(cwd, datasetValidationJsonPath)} + ${path.relative(cwd, datasetValidationMarkdownPath)}`
        : "dataset validation artifacts missing",
    action:
      fs.existsSync(datasetValidationJsonPath) && fs.existsSync(datasetValidationMarkdownPath)
        ? undefined
        : "run design-qa validate-dataset",
  });

  checks.push({
    label: "dataset-fix-prompt",
    ok: fs.existsSync(datasetFixPromptPath),
    detail: fs.existsSync(datasetFixPromptPath) ? path.relative(cwd, datasetFixPromptPath) : "dataset-fix-prompt.md missing",
    action: fs.existsSync(datasetFixPromptPath) ? undefined : "run design-qa dataset-fix when dataset repair guidance is needed",
  });

  checks.push({
    label: "dataset-fix-json",
    ok: fs.existsSync(datasetFixJsonPath),
    detail: fs.existsSync(datasetFixJsonPath) ? path.relative(cwd, datasetFixJsonPath) : "dataset-fix.json missing",
    action: fs.existsSync(datasetFixJsonPath) ? undefined : "run design-qa dataset-fix to generate machine-readable repair instructions",
  });

  checks.push({
    label: "semantic-eval-input",
    ok: !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalInputPath),
    detail: fs.existsSync(semanticEvalInputPath) ? path.relative(cwd, semanticEvalInputPath) : "semantic-eval.input.json missing",
    action:
      !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalInputPath)
        ? undefined
        : "run design-qa eval to generate semantic evaluator input",
  });

  checks.push({
    label: "semantic-eval-prompt",
    ok: !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalPromptPath),
    detail: fs.existsSync(semanticEvalPromptPath) ? path.relative(cwd, semanticEvalPromptPath) : "semantic-eval-prompt.md missing",
    action:
      !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalPromptPath)
        ? undefined
        : "run design-qa eval to generate semantic evaluator prompt",
  });

  checks.push({
    label: "semantic-eval-output",
    ok: !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalOutputPath),
    detail: fs.existsSync(semanticEvalOutputPath)
      ? path.relative(cwd, semanticEvalOutputPath)
      : "semantic-eval.output.json missing (agent-delegated evaluation pending)",
    action:
      !config.evaluation.semantic.enabled || fs.existsSync(semanticEvalOutputPath)
        ? undefined
        : "ask Codex or Claude Code to write semantic-eval.output.json from the generated prompt and input",
  });

  checks.push({
    label: "patch-plan",
    ok: fs.existsSync(patchPlanPath),
    detail: fs.existsSync(patchPlanPath) ? path.relative(cwd, patchPlanPath) : "patch-plan.json missing",
    action: fs.existsSync(patchPlanPath) ? undefined : "run design-qa eval to generate patch planning artifacts",
  });

  checks.push({
    label: "patch-prompt",
    ok: fs.existsSync(patchPromptPath),
    detail: fs.existsSync(patchPromptPath) ? path.relative(cwd, patchPromptPath) : "patch-prompt.md missing",
    action: fs.existsSync(patchPromptPath) ? undefined : "run design-qa eval to generate agent patch instructions",
  });

  const collectionPlanSync = inspectCollectionPlanSync(collectionPlanPath, activeRegistryEntries.map((entry) => entry.key));
  checks.push({
    label: "collection-plan",
    ok: collectionPlanSync.ok,
    detail: collectionPlanSync.detail,
    action: collectionPlanSync.ok ? undefined : "run design-qa prepare-figma-collection to refresh stale planning artifacts",
  });

  const figmaManifestPath = path.join(cwd, "src", "figma-sync", "manifest.json");
  if (fs.existsSync(figmaManifestPath)) {
    const ageHours = (Date.now() - fs.statSync(figmaManifestPath).mtimeMs) / (1000 * 60 * 60);
    checks.push({
      label: "figma-sync",
      ok: ageHours <= 24 * 7,
      detail: `manifest age ${ageHours.toFixed(1)}h`,
      action: ageHours <= 24 * 7 ? undefined : "refresh figma sync artifacts",
    });
  } else {
    checks.push({
      label: "figma-sync",
      ok: bridge.ok || datasetValidation.errors.length === 0,
      detail:
        datasetValidation.errors.length === 0
          ? "missing, but agent-prepared figma dataset is available"
          : bridge.ok
            ? "missing, but MCP bridge is available"
            : "src/figma-sync/manifest.json missing",
      action:
        bridge.ok || datasetValidation.errors.length === 0
          ? undefined
          : "either start MCP bridge or provide cached figma-sync artifacts",
    });
  }

  const storybookReachable = await isStorybookReachable(config.storybookUrl, cwd);
  const portReachability = await probeLocalPort(config.storybookUrl);
  checks.push({
    label: "storybook-port",
    ok: portReachability.ok,
    detail: portReachability.detail,
    action: portReachability.ok ? undefined : "start Storybook, free the port, or update storybookUrl in designqa.config.ts",
  });
  checks.push({
    label: "storybook",
    ok: storybookReachable,
    detail: storybookReachable ? `${config.storybookUrl} reachable` : `${config.storybookUrl} not reachable`,
    action:
      storybookReachable
        ? undefined
        : portReachability.ok
          ? "a process is listening on the Storybook port but HTTP is not healthy; inspect the Storybook startup logs"
          : "start Storybook or update storybookUrl in designqa.config.ts",
  });

  const firstEntry = Object.values(config.registry)[0];
  if (storybookReachable && firstEntry) {
    const probe = probeStoryRender(getStoryIframeUrl(config.storybookUrl, firstEntry), cwd);
    checks.push({
      label: "storybook-render",
      ok: probe.ok,
      detail: probe.ok ? `${firstEntry.key} rendered` : probe.error ?? "story render failed",
      action: probe.ok ? undefined : "fix the first mapped story so it renders cleanly in Storybook",
    });
  }

  const lines = ["# Design QA Doctor", "", `- Target repo: ${cwd}`];
  for (const check of checks) {
    lines.push(`- [${check.ok ? "ok" : "fail"}] ${check.label}: ${check.detail}`);
    if (check.action && !check.ok) {
      lines.push(`  action: ${check.action}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Blockers");
    for (const check of failed) {
      lines.push(`- ${check.label}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function inspectCollectionPlanSync(collectionPlanPath: string, registryKeys: string[]) {
  if (!fs.existsSync(collectionPlanPath)) {
    return { ok: false, detail: "collection-plan.json missing" };
  }
  try {
    const plan = JSON.parse(fs.readFileSync(collectionPlanPath, "utf-8")) as Array<{ collectionItemId?: string }>;
    const planPageKeys = plan
      .map((item) => item.collectionItemId)
      .filter((value): value is string => typeof value === "string" && value.startsWith("page:"))
      .map((value) => value.replace("page:", ""));
    const stale = planPageKeys.filter((key) => !registryKeys.includes(key));
    const missing = registryKeys.filter((key) => !planPageKeys.includes(key));
    if (stale.length === 0 && missing.length === 0) {
      return { ok: true, detail: "collection plan matches current registry" };
    }
    return {
      ok: false,
      detail: `stale pages: ${stale.join(", ") || "none"}; missing pages: ${missing.join(", ") || "none"}`,
    };
  } catch {
    return { ok: false, detail: "collection-plan.json is unreadable" };
  }
}

function safeSpawn(command: string, args: string[], cwd: string) {
  try {
    return spawnSync(command, args, { cwd, encoding: "utf-8" });
  } catch {
    return {
      status: 1,
      stdout: "",
      stderr: "",
    };
  }
}

function detectStorybookPackages(packageJson: Record<string, unknown> | null) {
  if (!packageJson) {
    return { ok: false, detail: "package.json missing" };
  }
  const deps = {
    ...(typeof packageJson.dependencies === "object" ? (packageJson.dependencies as Record<string, string>) : {}),
    ...(typeof packageJson.devDependencies === "object" ? (packageJson.devDependencies as Record<string, string>) : {}),
  };
  const storybookDeps = Object.entries(deps).filter(([name]) => name === "storybook" || name.startsWith("@storybook/"));
  if (storybookDeps.length === 0) {
    return { ok: false, detail: "no Storybook packages installed" };
  }
  const majors = new Map<string, string[]>();
  for (const [name, version] of storybookDeps) {
    const major = version.match(/\d+/)?.[0] ?? "unknown";
    const list = majors.get(major) ?? [];
    list.push(`${name}@${version}`);
    majors.set(major, list);
  }
  const hasFrameworkPackage = storybookDeps.some(([name]) => /@storybook\/(react|vue|svelte|nextjs|html|web-components)/.test(name));
  if (!hasFrameworkPackage) {
    return { ok: false, detail: `Storybook packages found but no framework package detected: ${storybookDeps.map(([name, version]) => `${name}@${version}`).join(", ")}` };
  }
  if (majors.size > 1) {
    return { ok: false, detail: `mixed Storybook majors detected: ${Array.from(majors.values()).flat().join(", ")}` };
  }
  return { ok: true, detail: storybookDeps.map(([name, version]) => `${name}@${version}`).join(", ") };
}

async function probeLocalPort(storybookUrl: string) {
  try {
    const url = new URL(storybookUrl);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      return { ok: true, detail: `non-local host ${url.hostname}` };
    }
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: url.hostname, port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    return { ok, detail: ok ? `${url.hostname}:${port} is accepting TCP connections` : `${url.hostname}:${port} is not accepting TCP connections` };
  } catch {
    return { ok: false, detail: `invalid Storybook URL: ${storybookUrl}` };
  }
}
