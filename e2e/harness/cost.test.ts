import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costOfReport, formatCost, limitProblems, main, parseMaxUsd, priceOf, tokensOf } from "./cost.mjs";

const FIXTURE = path.join(__dirname, "__fixtures__/cost-report.json");
const report = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

// Hand-computed with the claude-opus-5-5 prices ($/MTok: 4 in, 20 out, 0.20 cache read, 5 cache write):
// attempt 1: 100 000 uncached × 4 + 10 000 × 20 + 600 000 × 0.20 + 300 000 × 5 = 0.40 + 0.20 + 0.12 + 1.50 = 2.22 $
// attempt 2 (the retry, paid too): 0 uncached + 5 000 × 20 + 200 000 × 0.20 = 0.10 + 0.04 = 0.14 $
const EXPECTED_USD = 2.36;

describe("cost of an e2e report", () => {
  it("adds every step that called the model, retries included, per test and for the run", () => {
    const cost = costOfReport(report());
    expect(cost.calls).toBe(3);
    expect(cost.tokens).toEqual({ input: 100_000, output: 15_000, cacheRead: 800_000, cacheWrite: 300_000 });
    expect(cost.usd).toBeCloseTo(EXPECTED_USD, 10);
    expect(cost.tests.map((t) => [t.title, t.calls])).toEqual([
      ["group › a flow that the agent ran, then retried", 3],
      ["a flow replayed from the cache", 0],
    ]);
    expect(cost.tests[1].usd).toBe(0);
  });

  it("takes the cache reads and writes out of inputTokens, which includes them", () => {
    expect(tokensOf({ inputTokens: 18_770, outputTokens: 159, cacheReadTokens: 12_152, cacheWriteTokens: 6_612 })).toEqual({
      input: 6,
      output: 159,
      cacheRead: 12_152,
      cacheWrite: 6_612,
    });
    expect(() => tokensOf({ inputTokens: 10, cacheReadTokens: 20 })).toThrow(/fewer input tokens/);
  });

  it("refuses a model with no price instead of counting it free", () => {
    const r = report();
    r.run.results[0].attempts[1].steps[0].model.model = "some-new-model";
    expect(() => costOfReport(r)).toThrow(/no price for model "some-new-model"/);
    expect(() => priceOf("some-new-model", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toThrow();
  });

  it("prints one line when the run replayed everything", () => {
    const r = report();
    r.run.results = [r.run.results[1]];
    expect(formatCost(costOfReport(r))).toBe("1 test · 0 appel · 0,000 $");
    expect(formatCost(costOfReport(report())).split("\n")[0]).toBe("2 tests · 3 appels · 2,360 $");
  });
});

describe("limits", () => {
  it("reads E2E_MAX_USD with a comma or a dot, 1.00 when unset, and rejects anything else", () => {
    expect(parseMaxUsd(undefined)).toBe(1);
    expect(parseMaxUsd("")).toBe(1);
    expect(parseMaxUsd("1,50")).toBe(1.5);
    expect(parseMaxUsd("0.25")).toBe(0.25);
    expect(() => parseMaxUsd("cher")).toThrow(/E2E_MAX_USD/);
    expect(() => parseMaxUsd("-1")).toThrow(/E2E_MAX_USD/);
  });

  it("names the ceiling and the call limit the run went over", () => {
    const cost = costOfReport(report());
    expect(limitProblems(cost, { maxUsd: 3 })).toEqual([]);
    expect(limitProblems(cost, { maxUsd: 2 })).toEqual([expect.stringMatching(/2,360 \$.*E2E_MAX_USD=2,000 \$/)]);
    expect(limitProblems(cost, { maxUsd: 3, maxCalls: 0 })).toEqual([expect.stringMatching(/3 appels au modèle \(maximum 0\)/)]);
  });
});

describe("the command", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-cost-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exits 0 under the ceiling, 1 over it, 1 over --max-calls", () => {
    expect(main(["--report", FIXTURE], { E2E_MAX_USD: "3" })).toBe(0);
    expect(main(["--report", FIXTURE], { E2E_MAX_USD: "2" })).toBe(1);
    expect(main(["--report", FIXTURE], {})).toBe(1); // the 1.00 $ default
    expect(main(["--report", FIXTURE, "--max-calls", "0"], { E2E_MAX_USD: "3" })).toBe(1);
  });

  it("exits 2 when it cannot compute: unknown model, missing report, report older than the run", () => {
    const r = report();
    r.run.results[0].attempts[0].steps[1].model.model = "some-new-model";
    const unknown = path.join(dir, "unknown.json");
    fs.writeFileSync(unknown, JSON.stringify(r));
    expect(main(["--report", unknown], {})).toBe(2);
    expect(main(["--report", path.join(dir, "missing.json")], {})).toBe(2);
    expect(main(["--report", FIXTURE, "--not-before", "2026-10-16T11:00:00Z"], { E2E_MAX_USD: "3" })).toBe(2);
  });

  it("appends the Markdown summary for CI", () => {
    const summary = path.join(dir, "summary.md");
    main(["--report", FIXTURE, "--summary-md", summary, "--max-calls", "0"], { E2E_MAX_USD: "3" });
    const md = fs.readFileSync(summary, "utf8");
    expect(md).toContain("**2 tests · 3 appels au modèle · 2,360 $**");
    expect(md).toContain("| e2e/tests/a.e2e.ts › group › a flow that the agent ran, then retried | 3 | 2,360 $ |");
    expect(md).toMatch(/Échec :.*3 appels au modèle/);
  });
});
