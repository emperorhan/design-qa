import path from "node:path";

import { runDatasetFix, runValidateDataset } from "./dataset";
import { runDoctor } from "./doctor";
import { runEval } from "./eval";
import { runPrepareFigmaCollection } from "./figma-collection";
import { syncFigmaPage } from "./figma-sync";
import { runFix } from "./fix";
import { runGenerateStorybook } from "./generate";
import { runIngest } from "./ingest";
import { runInit } from "./init";
import { runDesignLoop } from "./loop";
import { validateStories } from "./validate";

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const { cwd, args } = resolveCliContext(rawArgs);

  switch (command) {
    case "validate":
    case "validate-stories": {
      const result = await validateStories(cwd);
      console.log(`Validated ${result.storyCount} design QA stories across ${result.fileCount} story files in ${cwd}.`);
      return;
    }
    case "loop": {
      const output = await runDesignLoop(args, cwd);
      if (output) {
        process.stdout.write(output);
      }
      return;
    }
    case "report": {
      const output = await runEval(["--report-only", ...args], cwd);
      if (output) {
        process.stdout.write(output);
      }
      return;
    }
    case "doctor": {
      process.stdout.write(await runDoctor(cwd));
      return;
    }
    case "prepare-figma-collection": {
      process.stdout.write(await runPrepareFigmaCollection(args, cwd));
      return;
    }
    case "validate-dataset": {
      process.stdout.write(await runValidateDataset(cwd));
      return;
    }
    case "dataset-fix": {
      process.stdout.write(await runDatasetFix(cwd));
      return;
    }
    case "sync-figma-page": {
      process.stdout.write(await syncFigmaPage(args, cwd));
      return;
    }
    case "ingest": {
      process.stdout.write(await runIngest(args, cwd));
      return;
    }
    case "generate": {
      if (args[0] !== "storybook") {
        throw new Error("Usage: design-qa generate storybook [--repo <path>]");
      }
      process.stdout.write(await runGenerateStorybook(args.slice(1), cwd));
      return;
    }
    case "eval": {
      process.stdout.write(await runEval(args, cwd));
      return;
    }
    case "fix": {
      process.stdout.write(await runFix(args, cwd));
      return;
    }
    case "init": {
      process.stdout.write(await runInit(cwd, args));
      return;
    }
    default:
      console.log(`Usage:
  design-qa validate [--repo <path>]
  design-qa validate-dataset [--repo <path>]
  design-qa dataset-fix [--repo <path>]
  design-qa prepare-figma-collection [--story <name>] [--repo <path>]
  design-qa doctor [--repo <path>]
  design-qa ingest <figma|screenshot|hybrid> [...] [--repo <path>]
  design-qa generate storybook [--repo <path>]
  design-qa eval [--story <name>] [--changed] [--threshold <n>] [--max-iterations <n>] [--repo <path>]
  design-qa fix [--repo <path>]
  design-qa sync-figma-page [--page <name>] [--depth <n>] [--timeout-ms <n>] [--repo <path>]
  design-qa loop [--story <name>] [--changed] [--threshold <n>] [--max-iterations <n>] [--repo <path>]
  design-qa report [--repo <path>]
  design-qa init [--repo <path>] [--force]`);
  }
}

function resolveCliContext(rawArgs: string[]) {
  const args = [...rawArgs];
  const repoIndex = args.indexOf("--repo");
  let cwd = process.cwd();
  if (repoIndex !== -1) {
    const repoArg = args[repoIndex + 1];
    if (!repoArg) {
      throw new Error("Missing value for --repo");
    }
    cwd = path.resolve(process.cwd(), repoArg);
    args.splice(repoIndex, 2);
  }
  return { cwd, args };
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
