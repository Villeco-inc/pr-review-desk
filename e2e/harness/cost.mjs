// What an e2e run cost in model calls, read from its report (.e2e/report.json).
//
//   node e2e/harness/cost.mjs                     the last report: summary, ceiling check
//   node e2e/harness/cost.mjs --report <file>     another report (e.g. .e2e/proofs/run1-report.json)
//   --history                                     also append one line to .e2e/cost-history.jsonl
//   --max-calls <n>                               fail when the run made more model calls (CI: 0)
//   --summary-md <file>                           also append a Markdown summary (CI: $GITHUB_STEP_SUMMARY)
//
// Exit codes: 0 within limits, 1 over a limit (E2E_MAX_USD, --max-calls), 2 cannot compute
// (no report, a model missing from PRICES). The figure is an estimate from the tokens the
// provider reported; the billed amount is in the console of the e2e workspace.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Prices ───────────────────────────────────────────────────────────────────
// US dollars per million tokens. Source: Anthropic's published API pricing, as quoted by the
// claude-api skill (cache of 2026-10-06). Cache writes are the 5-minute writes (1.25 × input).
// A model missing here stops the calculation: it never counts as free.
export const PRICES_AS_OF = "2026-10-06";
export const PRICES = {
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 },
};

export const DEFAULT_MAX_USD = 1.0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} Tokens */

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

/** The dollars for tokens of one model; throws for a model with no price. */
export function priceOf(model, tokens) {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model "${model}": add it to PRICES in e2e/harness/cost.mjs`);
  return (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + tokens.cacheWrite * p.cacheWrite) / 1e6;
}

/**
 * The tokens of one step's model block. The report's inputTokens includes the cache reads and
 * writes, so the uncached input is what is left once both are taken out.
 */
export function tokensOf(model) {
  const cacheRead = model.cacheReadTokens ?? 0;
  const cacheWrite = model.cacheWriteTokens ?? 0;
  const input = (model.inputTokens ?? 0) - cacheRead - cacheWrite;
  if (input < 0) throw new Error(`model block with fewer input tokens than cached ones: ${JSON.stringify(model)}`);
  return { input, output: model.outputTokens ?? 0, cacheRead, cacheWrite };
}

/** Calls, tokens and dollars per test (every attempt counts: a retry is paid too) and for the run. */
export function costOfReport(report) {
  const run = report?.run;
  if (!run || !Array.isArray(run.results)) throw new Error("not an e2e report: no run.results");
  const tests = run.results.map((result) => {
    const steps = [];
    for (const attempt of result.attempts ?? []) {
      for (const step of attempt.steps ?? []) {
        if (!step.model) continue;
        const tokens = tokensOf(step.model);
        steps.push({ label: `${step.api} "${step.label}"`, model: step.model.model, calls: step.model.calls ?? 0, tokens, usd: priceOf(step.model.model, tokens) });
      }
    }
    return {
      file: result.file,
      title: (result.titlePath ?? []).join(" › "),
      status: result.status,
      calls: steps.reduce((n, s) => n + s.calls, 0),
      tokens: steps.reduce((t, s) => add(t, s.tokens), zero()),
      usd: steps.reduce((d, s) => d + s.usd, 0),
      steps,
    };
  });
  return {
    tests,
    calls: tests.reduce((n, t) => n + t.calls, 0),
    tokens: tests.reduce((t, x) => add(t, x.tokens), zero()),
    usd: tests.reduce((d, t) => d + t.usd, 0),
  };
}

// ── Output ───────────────────────────────────────────────────────────────────
const n = (x) => x.toLocaleString("fr-CA");
export const usd = (x) => `${x.toFixed(3).replace(".", ",")} $`;
const plural = (count, word) => `${n(count)} ${word}${count > 1 ? "s" : ""}`;
const tokenText = (t) => `entrée ${n(t.input)} · sortie ${n(t.output)} · cache lu ${n(t.cacheRead)} · cache écrit ${n(t.cacheWrite)}`;

/** One line when nothing called the model; otherwise also each test and step that did. */
export function formatCost(cost) {
  const lines = [`${plural(cost.tests.length, "test")} · ${plural(cost.calls, "appel")} · ${usd(cost.usd)}`];
  if (cost.calls === 0) return lines.join("\n");
  lines.push(`  jetons : ${tokenText(cost.tokens)}`);
  for (const test of cost.tests.filter((t) => t.calls > 0)) {
    lines.push(`  ${test.file} › ${test.title} : ${plural(test.calls, "appel")} · ${usd(test.usd)}`);
    for (const step of test.steps.filter((s) => s.calls > 0)) lines.push(`    ${step.label} : ${plural(step.calls, "appel")} · ${usd(step.usd)} (${tokenText(step.tokens)})`);
  }
  return lines.join("\n");
}

export function formatMarkdown(cost, problems) {
  const rows = cost.tests
    .filter((t) => t.calls > 0)
    .map((t) => `| ${t.file} › ${t.title} | ${t.calls} | ${usd(t.usd)} |`);
  return [
    "### Coût e2e",
    "",
    `**${plural(cost.tests.length, "test")} · ${plural(cost.calls, "appel")} au modèle · ${usd(cost.usd)}** (estimé, prix du ${PRICES_AS_OF})`,
    ...(rows.length ? ["", "| Test | Appels | Coût |", "| --- | ---: | ---: |", ...rows] : []),
    ...problems.map((p) => `\n> **Échec :** ${p}`),
    "",
  ].join("\n");
}

/** E2E_MAX_USD as a number of dollars ("1,50" and "1.50" both read 1.5); the default when unset. */
export function parseMaxUsd(raw) {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_USD;
  const value = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < 0) throw new Error(`E2E_MAX_USD is not an amount in dollars: "${raw}"`);
  return value;
}

/** What breaks a limit, as messages; empty when the run is within them. */
export function limitProblems(cost, { maxUsd, maxCalls }) {
  const problems = [];
  if (cost.usd > maxUsd) problems.push(`le run a coûté ${usd(cost.usd)}, au-dessus du plafond E2E_MAX_USD=${usd(maxUsd)}`);
  if (maxCalls !== undefined && cost.calls > maxCalls) {
    problems.push(`le run a fait ${plural(cost.calls, "appel")} au modèle (maximum ${maxCalls}) : une étape n'a pas été rejouée depuis .e2e/cache ; ré-enregistre-la en local (npm run test:e2e) et committe le cache`);
  }
  return problems;
}

export function historyEntry(cost, report, date = new Date()) {
  const vcs = report.run.vcs ?? {};
  return {
    date: date.toISOString(),
    commit: vcs.commit ?? null,
    branch: vcs.branch ?? null,
    dirty: vcs.dirty ?? null,
    status: report.run.status ?? null,
    tests: cost.tests.length,
    calls: cost.calls,
    tokens: cost.tokens,
    usd: Math.round(cost.usd * 1e6) / 1e6,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function args(argv) {
  const opts = { report: path.join(ROOT, ".e2e/report.json"), history: false, maxCalls: undefined, summaryMd: undefined, notBefore: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") opts.report = path.resolve(argv[++i]);
    else if (a === "--history") opts.history = true;
    else if (a === "--max-calls") opts.maxCalls = Number(argv[++i]);
    else if (a === "--summary-md") opts.summaryMd = argv[++i];
    else if (a === "--not-before") opts.notBefore = new Date(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let opts, report, cost, maxUsd;
  try {
    opts = args(argv);
    maxUsd = parseMaxUsd(env.E2E_MAX_USD);
    if (!fs.existsSync(opts.report)) throw new Error(`no report at ${opts.report}`);
    report = JSON.parse(fs.readFileSync(opts.report, "utf8"));
    // After a run, a report older than the run is the previous run's: the run wrote none.
    if (opts.notBefore && !(new Date(report.run?.startedAt) >= opts.notBefore)) throw new Error(`${opts.report} is from an earlier run: this run wrote no report`);
    cost = costOfReport(report);
  } catch (err) {
    console.error(`[e2e cost] cannot compute the cost: ${err.message}`);
    return 2;
  }

  const problems = limitProblems(cost, { maxUsd, maxCalls: opts.maxCalls });
  console.log(`[e2e cost] ${formatCost(cost)}`);
  for (const p of problems) console.error(`[e2e cost] ÉCHEC : ${p}`);
  if (opts.history) {
    let entry = historyEntry(cost, report);
    if (!entry.commit) {
      try {
        entry = { ...entry, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() };
      } catch {
        // not a git checkout: the commit stays null
      }
    }
    fs.appendFileSync(path.join(ROOT, ".e2e/cost-history.jsonl"), `${JSON.stringify(entry)}\n`);
  }
  if (opts.summaryMd) fs.appendFileSync(opts.summaryMd, formatMarkdown(cost, problems));
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
