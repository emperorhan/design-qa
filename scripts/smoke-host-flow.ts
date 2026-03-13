import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliBin = path.join(repoRoot, "bin", "design-qa.js");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-qa-smoke-"));

run(["init", "--repo", tmpDir, "--force"]);
run(["validate-dataset", "--repo", tmpDir]);
run(["dataset-fix", "--repo", tmpDir]);
run(["prepare-figma-collection", "--repo", tmpDir]);
run(["ingest", "figma", "--repo", tmpDir]);
run(["generate", "storybook", "--repo", tmpDir]);

const summaryPath = path.join(tmpDir, ".design-qa", "latest-summary.json");
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      storybookUrl: "http://127.0.0.1:6006",
      runDir: ".design-qa/runs/mock",
      threshold: 90,
      totalStories: 1,
      passedStories: [],
      failedStories: ["Pages/Example.Default"],
      stories: [
        {
          entryKey: "Pages/Example.Default",
          title: "Pages/Example",
          exportName: "Default",
          figmaNodeId: "123:456",
          iframeUrl: "http://127.0.0.1:6006/iframe.html?id=pages-example--default&viewMode=story",
          passed: false,
          finalScore: 72,
          iterations: [
            {
              iteration: 1,
              score: 72,
              passed: false,
              criticalViolations: [],
              metrics: {
                overflowCount: 1,
                dimensionMismatch: 0.2,
                pixelDiffRatio: 0.15,
                screenshotPath: ".design-qa/runs/mock/story.png",
                diffPath: ".design-qa/runs/mock/diff.png",
                referencePath: "figma-refs/screens/example-default.png",
              },
            },
          ],
        },
      ],
    },
    null,
    2,
  ),
);

run(["eval", "--report-only", "--repo", tmpDir]);

assertExists(path.join(tmpDir, ".design-qa", "dataset-fix.json"));
assertExists(path.join(tmpDir, ".design-qa", "figma", "collection-plan.json"));
assertExists(path.join(tmpDir, ".design-qa", "patch-plan.json"));

const patchPlan = JSON.parse(fs.readFileSync(path.join(tmpDir, ".design-qa", "patch-plan.json"), "utf-8")) as {
  stories: Array<{
    primaryTargetFile: string;
    secondaryTargetFiles: string[];
  }>;
};
if (patchPlan.stories[0]?.primaryTargetFile !== "src/stories/Example.stories.tsx") {
  throw new Error(`unexpected primaryTargetFile: ${patchPlan.stories[0]?.primaryTargetFile}`);
}
if (!patchPlan.stories[0]?.secondaryTargetFiles.includes("src/components/ExampleCard.tsx")) {
  throw new Error("expected secondary target file to include src/components/ExampleCard.tsx");
}

const agents = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
if (!agents.includes("## Dataset Phase") || !agents.includes("## Patch Phase")) {
  throw new Error("AGENTS.md is missing dataset/patch phase sections");
}

const collectionPlan = JSON.parse(fs.readFileSync(path.join(tmpDir, ".design-qa", "figma", "collection-plan.json"), "utf-8")) as Array<{
  collectionItemId: string;
  recommendedAction: string;
  phase: string;
}>;
if (!collectionPlan.every((item) => item.collectionItemId && item.recommendedAction && item.phase === "dataset")) {
  throw new Error("collection-plan.json is missing collection item linkage");
}

console.log(`smoke:host-flow passed (${tmpDir})`);

function run(args: string[]) {
  execFileSync(process.execPath, [cliBin, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function assertExists(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`expected file to exist: ${filePath}`);
  }
}
