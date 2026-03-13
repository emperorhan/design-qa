import path from "node:path";

import { runExportAgentTask } from "./agent-task";
import { runCollect, runDatasetFix, runDetectFigmaSource, runInspectDataset, runNormalizeIcons, runValidateDataset } from "./dataset";
import { runDoctor } from "./doctor";
import { runEval } from "./eval";
import { runPrepareFigmaCollection } from "./figma-collection";
import { syncFigmaPage } from "./figma-sync";
import { runFix } from "./fix";
import { runGenerateStorybook } from "./generate";
import { runIngest } from "./ingest";
import { runInit } from "./init";
import { runDesignLoop } from "./loop";
import {
  collectDesignQa,
  evaluateDesignQa,
  generateDesignQa,
  inspectDesignQaDataset,
  validateDesignQaDataset,
} from "./toolkit";
import { validateStories } from "./validate";

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const { cwd, args } = resolveCliContext(rawArgs);
  const json = args.includes("--json");
  const commandArgs = args.filter((arg) => arg !== "--json");

  switch (command) {
    case "validate":
    case "validate-stories": {
      const result = await validateStories(cwd);
      if (json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              summary: `Validated ${result.storyCount} design QA stories across ${result.fileCount} story files in ${cwd}.`,
              data: result,
              artifacts: [],
              warnings: [],
              errors: [],
              nextActions: [],
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`Validated ${result.storyCount} design QA stories across ${result.fileCount} story files in ${cwd}.`);
      }
      return;
    }
    case "loop": {
      const output = await runDesignLoop(commandArgs, cwd);
      if (output) {
        process.stdout.write(output);
      }
      return;
    }
    case "report": {
      const output = json
        ? await evaluateDesignQa({ cwd, args: ["--report-only", ...commandArgs] })
        : await runEval(["--report-only", ...commandArgs], cwd);
      if (output) {
        process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
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
    case "collect": {
      const output = json ? await collectDesignQa({ cwd, args: commandArgs }) : await runCollect(commandArgs, cwd);
      process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    case "export-agent-task": {
      process.stdout.write(await runExportAgentTask(args, cwd));
      return;
    }
    case "validate-dataset": {
      const output = json ? await validateDesignQaDataset({ cwd }) : await runValidateDataset(cwd);
      process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    case "dataset-fix": {
      process.stdout.write(await runDatasetFix(cwd));
      return;
    }
    case "detect-figma-source": {
      process.stdout.write(await runDetectFigmaSource(cwd));
      return;
    }
    case "inspect-dataset": {
      const output = json ? await inspectDesignQaDataset({ cwd }) : await runInspectDataset(cwd);
      process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    case "normalize-icons": {
      process.stdout.write(await runNormalizeIcons(cwd));
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
      const generateArgs = commandArgs[0] === "storybook" ? commandArgs.slice(1) : commandArgs;
      const output = json ? await generateDesignQa({ cwd, args: generateArgs }) : await runGenerateStorybook(generateArgs, cwd);
      process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
      return;
    }
    case "eval": {
      const output = json ? await evaluateDesignQa({ cwd, args: commandArgs }) : await runEval(commandArgs, cwd);
      process.stdout.write(typeof output === "string" ? output : `${JSON.stringify(output, null, 2)}\n`);
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
  design-qa collect [--agent <codex|claude|generic>] [--story <name>] [--json] [--repo <path>]
  design-qa validate-dataset [--json] [--repo <path>]
  design-qa dataset-fix [--repo <path>]
  design-qa detect-figma-source [--repo <path>]
  design-qa inspect-dataset [--json] [--repo <path>]
  design-qa normalize-icons [--repo <path>]
  design-qa prepare-figma-collection [--story <name>] [--repo <path>]
  design-qa export-agent-task <figma-dataset|patch> [--agent <codex|claude|generic>] [--story <name>] [--repo <path>]
  design-qa doctor [--repo <path>]
  design-qa ingest <figma|screenshot|hybrid> [...] [--repo <path>]
  design-qa generate [storybook] [--json] [--repo <path>]
  design-qa eval [--story <name>] [--changed] [--threshold <n>] [--max-iterations <n>] [--json] [--repo <path>]
  design-qa fix [--repo <path>]
  design-qa sync-figma-page [--page <name>] [--depth <n>] [--timeout-ms <n>] [--repo <path>]
  design-qa loop [--story <name>] [--changed] [--threshold <n>] [--max-iterations <n>] [--repo <path>]
  design-qa report [--json] [--repo <path>]
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
  const wantsJson = process.argv.includes("--json");
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          summary: message,
          data: null,
          artifacts: [],
          warnings: [],
          errors: [message],
          nextActions: [],
        },
        null,
        2,
      ),
    );
  } else {
    console.error(message);
  }
  process.exit(1);
});
