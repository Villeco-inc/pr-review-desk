// npm run test:e2e: runs `e2e run` with the arguments given, then the cost of that run
// (cost.mjs, with a line in .e2e/cost-history.jsonl), whatever the tests did.
// The exit code is the tests' when they failed, else the cost check's (E2E_MAX_USD).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as cost } from "./cost.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const startedAt = new Date();
const e2e = spawnSync(path.join(ROOT, "node_modules/.bin/e2e"), ["run", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" });
const testsCode = e2e.status ?? 1;

const costCode = cost(["--history", "--not-before", startedAt.toISOString()]);
process.exitCode = testsCode !== 0 ? testsCode : costCode;
