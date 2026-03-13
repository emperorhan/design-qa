#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../src/cli.ts");
const tsxSearchPaths = [
  process.cwd(),
  path.resolve(__dirname, ".."),
  path.resolve(__dirname, "../.."),
  path.resolve(__dirname, "../../../node_modules"),
];

let result;
try {
  const tsxPath = require.resolve("tsx", {
    paths: tsxSearchPaths,
  });
  result = spawnSync(process.execPath, ["--import", tsxPath, cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
} catch {
  const bunCandidate = process.env.BUN_PATH || "bun";
  const bunVersion = spawnSync(bunCandidate, ["--version"], {
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
  });
  if (bunVersion.status !== 0) {
    console.error("design-qa could not find a TS runtime. Install tsx or bun.");
    process.exit(1);
  }
  result = spawnSync(bunCandidate, [cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
}

process.exit(result.status ?? 1);
