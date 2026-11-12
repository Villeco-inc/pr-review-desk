// Starts the Desk inside a closed world, for e2e's app.command:
// - a fresh folder ($E2E_WORLD) that holds the database (data/reviews.db), the run logs, the fake
//   CLIs' journals and a local git checkout to review, deleted when the server stops;
// - the fake `gh` and `claude` of e2e/harness/bin first on PATH, checked before the server starts,
//   so no test ever reaches GitHub or a model;
// - the production build (npm run build) served by the server alone on $PORT.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE_BIN = path.join(ROOT, "e2e/harness/bin");
const SERVER = path.join(ROOT, "server/dist/server/src/index.js");
const WORLD = process.env.E2E_WORLD;
const PORT = process.env.PORT;

function die(message) {
  console.error(`[e2e world] ${message}`);
  process.exit(1);
}

if (!WORLD || !path.isAbsolute(WORLD)) die("E2E_WORLD must be an absolute path");
if (!PORT) die("PORT is not set");
if (!fs.existsSync(SERVER) || !fs.existsSync(path.join(ROOT, "dist/index.html"))) die("no build: run `npm run build` first (npm run test:e2e does)");

// ── The world ────────────────────────────────────────────────────────────────
fs.rmSync(WORLD, { recursive: true, force: true });
fs.mkdirSync(path.join(WORLD, "data"), { recursive: true });
fs.symlinkSync(path.join(ROOT, "dist"), path.join(WORLD, "dist"));
for (const journal of ["gh-calls.jsonl", "gh-writes.jsonl", "gh-failures.jsonl", "claude-calls.jsonl"]) fs.writeFileSync(path.join(WORLD, journal), "");

// A local checkout with a branch to review: main has add(), feat/divide adds divide().
const repo = path.join(WORLD, "repos/sample-app");
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.test",
      GIT_COMMITTER_NAME: "E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.test",
      GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: "pipe",
  });
git("init", "-q", "-b", "main");
fs.writeFileSync(path.join(repo, "src/math.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
git("add", "-A");
git("commit", "-q", "-m", "Add add()");
git("checkout", "-q", "-b", "feat/divide");
fs.appendFileSync(path.join(repo, "src/math.ts"), "\nexport function divide(a: number, b: number): number {\n  return a / b;\n}\n");
git("commit", "-q", "-am", "Add divide()");
git("checkout", "-q", "main");

// ── The server's environment ─────────────────────────────────────────────────
const env = { ...process.env };
// Nothing that could reach the real services, whatever the caller exported: no GitHub or Claude
// token, and no TYPESAFE_API_KEY, so Jev stays off.
for (const key of Object.keys(env)) if (/^(GH_|GITHUB_|CLAUDE_|ANTHROPIC_|TYPESAFE_)/.test(key) || key === "REPOS" || key === "SCAN_DIR") delete env[key];
Object.assign(env, {
  PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
  NODE_ENV: "production",
  PORT,
  E2E_WORLD: WORLD,
  REPOS_ROOT: path.join(WORLD, "repos"),
  LOCAL_REPOS: "sample-app=sample-app",
});

for (const tool of ["gh", "claude"]) {
  const found = execFileSync("which", [tool], { env, encoding: "utf8" }).trim();
  if (found !== path.join(FAKE_BIN, tool)) die(`${tool} resolves to ${found}, not the fake one in ${FAKE_BIN}`);
}

// ── Run, then clean up ───────────────────────────────────────────────────────
const server = spawn(process.execPath, [SERVER], { cwd: WORLD, env, stdio: "inherit" });
console.log(`[e2e world] ${WORLD} — server pid ${server.pid} on :${PORT}`);

let stopping = false;
const cleanup = () => {
  if (process.env.E2E_KEEP_WORLD === "1") console.log(`[e2e world] kept ${WORLD}`);
  else fs.rmSync(WORLD, { recursive: true, force: true });
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    server.kill("SIGTERM");
  });
}
server.on("exit", (code, signal) => {
  cleanup();
  process.exit(stopping ? 0 : code ?? (signal ? 1 : 0));
});
