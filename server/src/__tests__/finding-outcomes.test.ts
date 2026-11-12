import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, migrateFindingQuality } from "../db/schema";
import { findingOutcomeRows, repoOf, summarizeFindingOutcomes } from "../services/finding-outcomes";

let db: Database.Database;

function review(id: string, updatedAt = "2026-10-01T00:00:00Z") {
  db.prepare("INSERT INTO reviews (id, repo, number, created_at, updated_at) VALUES (?, ?, 0, ?, ?)").run(id, id.split("#")[0], updatedAt, updatedAt);
}
function run(id: string, reviewId: string, model: string | null, effort: string | null, status: string, finishedAt: string) {
  db.prepare("INSERT INTO review_runs (id, review_id, status, model, effort, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, reviewId, status, model, effort, finishedAt, finishedAt);
}
function finding(id: string, reviewId: string, severity: string, state: string, runId: string | null = null) {
  db.prepare("INSERT INTO findings (id, review_id, severity, state, run_id) VALUES (?, ?, ?, ?, ?)").run(id, reviewId, severity, state, runId);
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  migrateFindingQuality(db);
});

describe("repoOf", () => {
  it("keeps owner/repo and drops the branch hash of local and compare reviews", () => {
    expect(repoOf("Villeco-inc/linea-web#656")).toBe("Villeco-inc/linea-web");
    expect(repoOf("local/linea-web-1b482977cc#0")).toBe("local/linea-web");
    expect(repoOf("compare/linea-geo-api-b7eee4ac1a#0")).toBe("compare/linea-geo-api");
  });
});

describe("findingOutcomeRows", () => {
  it("uses run_id when set and otherwise the review's latest reported run", () => {
    review("o/r#1");
    run("old", "o/r#1", "opus", "thorough", "reported", "2026-10-02T00:00:00Z");
    run("new", "o/r#1", "haiku", "quick", "reported", "2026-10-03T00:00:00Z");
    run("failed", "o/r#1", "sonnet", "quick", "failed", "2026-10-04T00:00:00Z");
    finding("a", "o/r#1", "nit", "dismissed", "old");
    finding("b", "o/r#1", "nit", "open");
    const rows = Object.fromEntries(findingOutcomeRows(db, "2026-01-01").map((r) => [r.id, r]));
    expect(rows.a).toMatchObject({ run_id: "old", model: "opus" });
    expect(rows.b).toMatchObject({ run_id: "new", model: "haiku" });
  });

  it("falls back only to runs finished before the finding's creation when findings carry created_at", () => {
    review("o/r#1");
    run("before", "o/r#1", "opus", "thorough", "reported", "2026-10-02T00:00:00Z");
    run("after", "o/r#1", "haiku", "quick", "reported", "2026-10-05T00:00:00Z");
    finding("a", "o/r#1", "low", "open");
    db.prepare("UPDATE findings SET created_at = '2026-10-03T00:00:00Z'").run();
    expect(findingOutcomeRows(db, "2026-01-01")[0]).toMatchObject({ run_id: "before" });
  });

  it("filters on the producing run's date, or the review's when there is no run", () => {
    review("o/r#1", "2026-09-01T00:00:00Z");
    review("o/r#2", "2026-10-10T00:00:00Z");
    run("r1", "o/r#1", "opus", "thorough", "reported", "2026-09-01T00:00:00Z");
    finding("a", "o/r#1", "low", "posted");
    finding("b", "o/r#2", "low", "posted");
    expect(findingOutcomeRows(db, "2026-10-01").map((r) => r.id)).toEqual(["b"]);
  });
});

describe("summarizeFindingOutcomes", () => {
  it("counts each state by severity, model and repository", () => {
    review("o/r#1");
    review("local/web-0123456789#0");
    run("h", "o/r#1", "haiku", "quick", "reported", "2026-10-02T00:00:00Z");
    run("d", "local/web-0123456789#0", null, null, "reported", "2026-10-02T00:00:00Z");
    finding("1", "o/r#1", "nit", "dismissed");
    finding("2", "o/r#1", "nit", "dismissed");
    finding("3", "o/r#1", "nit", "posted");
    finding("4", "o/r#1", "nit", "open");
    finding("5", "o/r#1", "nit", "open");
    finding("6", "local/web-0123456789#0", "high", "resolved");
    const s = summarizeFindingOutcomes(findingOutcomeRows(db, "2026-01-01"), false);
    expect(s.totals).toEqual({ total: 6, open: 2, posted: 1, dismissed: 2, resolved: 1 });
    expect(s.bySeverity.map((r) => r.severity)).toEqual(["high", "nit"]);
    expect(s.byModel).toContainEqual({ model: "haiku", effort: "quick", total: 5, open: 2, posted: 1, dismissed: 2, resolved: 0 });
    expect(s.byModel).toContainEqual({ model: "default", effort: "—", total: 1, open: 0, posted: 0, dismissed: 0, resolved: 1 });
    expect(s.byRepo.map((r) => r.repo)).toEqual(["o/r", "local/web"]);
  });

  it("puts a finding with no run under the unknown model", () => {
    review("o/r#1");
    finding("1", "o/r#1", "low", "posted");
    expect(summarizeFindingOutcomes(findingOutcomeRows(db, "2026-01-01"), false).byModel[0]).toMatchObject({ model: "unknown", effort: "—" });
  });

  it("reads Jev's probabilities with the thresholds, crosses them with the reviewer's decision, and keeps unjudged findings apart", () => {
    review("o/r#1");
    for (const [id, state] of [["1", "dismissed"], ["2", "dismissed"], ["3", "posted"], ["4", "posted"], ["5", "open"]]) finding(id, "o/r#1", "low", state);
    const judge = db.prepare("INSERT INTO finding_judgments (finding_id, review_id, judged_at, nit, holds, severity_score) VALUES (?, 'o/r#1', 'now', ?, ?, ?)");
    judge.run("1", 0.9, 0.2, 0);
    judge.run("2", 0.5, 0.5, 1); // balanced evidence: uncertain on both, never a no
    judge.run("3", 0.1, 0.8, 3);
    judge.run("4", 0.3, 0.7, 2);
    const { jev } = summarizeFindingOutcomes(findingOutcomeRows(db, "2026-01-01"), true);
    expect(jev).toMatchObject({ enabled: true, judged: 4, thresholds: { yes: 0.6, no: 0.4 } });
    const by = Object.fromEntries(jev.verdicts.map((v) => [v.verdict, v]));
    expect(by.nit).toMatchObject({ total: 1, dismissed: 1 });
    expect(by["nit-uncertain"]).toMatchObject({ total: 1, dismissed: 1 });
    expect(by["not-nit"]).toMatchObject({ total: 2, posted: 2 });
    expect(by.fails).toMatchObject({ total: 1, dismissed: 1 });
    expect(by["holds-uncertain"]).toMatchObject({ total: 1 });
    expect(by.holds).toMatchObject({ total: 2, posted: 2 });
    expect(by.unjudged).toMatchObject({ total: 1, open: 1 });
    expect(jev.byDecision).toContainEqual({ state: "dismissed", judged: 2, meanNit: 0.7, meanHolds: 0.35, meanSeverity: 0.5 });
    expect(jev.byDecision).toContainEqual({ state: "posted", judged: 2, meanNit: 0.2, meanHolds: 0.75, meanSeverity: 2.5 });
  });
});
