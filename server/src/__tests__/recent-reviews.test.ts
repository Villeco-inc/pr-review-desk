import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate, migrateFindingQuality } from "../db/schema";
import { markApproved, pasteVerdict, recentPrReviews } from "../services/recent-reviews";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  migrateFindingQuality(db);
  return db;
}

const review = (db: Database.Database, repo: string, number: number, status: string, updatedAt: string, title = "") =>
  db
    .prepare("INSERT INTO reviews (id, repo, number, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(`${repo}#${number}`, repo, number, title, status, updatedAt, updatedAt);

let seq = 0;
const run = (db: Database.Database, reviewId: string, status: string, headSha: string | null, startedAt: string) =>
  db.prepare("INSERT INTO review_runs (id, review_id, status, head_sha, started_at) VALUES (?, ?, ?, ?, ?)").run(`run${seq++}`, reviewId, status, headSha, startedAt);

const finding = (db: Database.Database, id: string, reviewId: string, severity: string, state = "open") =>
  db.prepare("INSERT INTO findings (id, review_id, severity, state) VALUES (?, ?, ?, ?)").run(id, reviewId, severity, state);

const PR = "acme/api#655";

describe("pasting a pull request on the home screen", () => {
  it("starts a run when commits arrived since the last reported run", () => {
    const db = openDb();
    review(db, "acme/api", 655, "reported", "2026-11-01T10:00:00.000Z");
    run(db, PR, "reported", "aaa111", "2026-11-01T09:55:00.000Z");
    expect(pasteVerdict(db, PR, "bbb222")).toBe("start");
  });

  it("starts nothing when the last reported run already read the current commit", () => {
    const db = openDb();
    review(db, "acme/api", 655, "reported", "2026-11-01T10:00:00.000Z");
    run(db, PR, "reported", "000000", "2026-11-01T08:00:00.000Z");
    run(db, PR, "reported", "aaa111", "2026-11-01T09:55:00.000Z");
    expect(pasteVerdict(db, PR, "aaa111")).toBe("unchanged");
  });

  it("starts no second run while one is going, even with new commits", () => {
    const db = openDb();
    review(db, "acme/api", 655, "running", "2026-11-01T10:00:00.000Z");
    run(db, PR, "reported", "aaa111", "2026-11-01T09:00:00.000Z");
    expect(pasteVerdict(db, PR, "bbb222")).toBe("running");
  });

  it("starts a run when no reported run has a known commit: failed, cancelled, or recorded before commits were", () => {
    const db = openDb();
    review(db, "acme/api", 655, "failed", "2026-11-01T10:00:00.000Z");
    run(db, PR, "reported", null, "2026-11-01T07:00:00.000Z");
    run(db, PR, "failed", "aaa111", "2026-11-01T08:00:00.000Z");
    run(db, PR, "cancelled", "aaa111", "2026-11-01T09:00:00.000Z");
    expect(pasteVerdict(db, PR, "aaa111")).toBe("start");
  });

  it("starts a run on a pull request never reviewed", () => {
    expect(pasteVerdict(openDb(), PR, "aaa111")).toBe("start");
  });
});

describe("recent pull request reviews", () => {
  it("puts a pinned review first even when it is older than the page, without listing it twice", () => {
    const db = openDb();
    for (let n = 1; n <= 5; n++) review(db, "acme/api", n, "reported", `2026-11-01T10:0${n}:00.000Z`);
    expect(recentPrReviews(db, 3, 0, "acme/api#1").reviews.map((r) => r.number)).toEqual([1, 5, 4, 3]);
    expect(recentPrReviews(db, 3, 0, "acme/api#4").reviews.map((r) => r.number)).toEqual([4, 5, 3]);
    expect(recentPrReviews(db, 3, 0, "acme/api#99").reviews.map((r) => r.number)).toEqual([5, 4, 3]);
  });

  it("lists the 20 most recently updated, then the rest, leaving out local branches and comparisons", () => {
    const db = openDb();
    for (let n = 1; n <= 25; n++) review(db, "acme/api", n, "reported", `2026-11-01T10:${String(n).padStart(2, "0")}:00.000Z`);
    for (let n = 1; n <= 3; n++) review(db, `local/desk-abc${n}`, 0, "reported", "2026-11-02T00:00:00.000Z");
    review(db, "compare/api-def", 0, "reported", "2026-11-02T00:00:00.000Z");

    const first = recentPrReviews(db, 20, 0);
    expect(first.reviews.map((r) => r.number)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    expect(first.hasMore).toBe(true);

    const rest = recentPrReviews(db, 20, 20);
    expect(rest.reviews.map((r) => r.number)).toEqual([5, 4, 3, 2, 1]);
    expect(rest.hasMore).toBe(false);
  });

  it("gives each card its title, target, state and standing findings per severity", () => {
    const db = openDb();
    review(db, "acme/api", 655, "reported", "2026-11-01T10:00:00.000Z", "Corrige le calcul");
    finding(db, "h1", PR, "high");
    finding(db, "m1", PR, "medium");
    finding(db, "m2", PR, "medium", "posted");
    finding(db, "n1", PR, "nit");
    finding(db, "b1", PR, "blocker", "dismissed");
    finding(db, "l1", PR, "low", "resolved");
    db.prepare("INSERT INTO finding_judgments (finding_id, review_id, judged_at, holds) VALUES ('h1', ?, '2026-11-01T10:01:00.000Z', 0.9)").run(PR);

    const [card] = recentPrReviews(db, 20, 0).reviews;
    expect(card).toMatchObject({ title: "Corrige le calcul", repo: "acme/api", number: 655, status: "reported", postedFindings: 1, approved: false });
    expect(card.severities).toEqual({ high: 1, medium: 2, nit: 1 });
    expect(card.openFindings).toEqual([
      { id: "h1", jevHolds: 0.9 },
      { id: "m1", jevHolds: null },
      { id: "n1", jevHolds: null },
    ]);
  });

  it("marks a review approved until a later run reports", () => {
    const db = openDb();
    review(db, "acme/api", 655, "reported", "2026-11-01T10:00:00.000Z");
    expect(recentPrReviews(db, 20, 0).reviews[0].approved).toBe(false);

    markApproved(db, PR, new Date("2026-11-01T10:05:00.000Z"));
    expect(recentPrReviews(db, 20, 0).reviews[0].approved).toBe(true);

    db.prepare("UPDATE reviews SET status = 'reported', updated_at = '2026-11-01T11:00:00.000Z' WHERE id = ?").run(PR);
    expect(recentPrReviews(db, 20, 0).reviews[0].approved).toBe(false);
  });
});
