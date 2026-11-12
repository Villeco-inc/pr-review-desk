import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { autoReviewDecision, spentTodayUsd, utcDayStart } from "../services/auto-review";
import { defaultWatchSettings, getWatchSettings, saveWatchSettings } from "../services/watch-settings";
import type { WatchEvent } from "../services/github-watch";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

const run = (db: Database.Database, startedAt: string, cost: number | null) =>
  db.prepare("INSERT INTO review_runs (id, review_id, started_at, cost_usd) VALUES (?, 'a/b#1', ?, ?)").run(`${startedAt}-${cost}`, startedAt, cost);

const pushed: WatchEvent = { kind: "new-commits", repo: "a/b", number: 1, title: "One", url: "u", head: "bbb", reviewedHead: "aaa" };
const requested: WatchEvent = { kind: "review-requested", repo: "a/b", number: 2, title: "Two", url: "u", author: "x" };
const reply: WatchEvent = { kind: "comment-reply", repo: "a/b", number: 1, title: "One", url: "u", author: "x", body: "ok", commentId: 9 };
const on = { ...defaultWatchSettings(), autoReviewRepos: ["a/b"], dailyCapUsd: 5 };

describe("daily cost cap", () => {
  it("adds up today's runs in UTC, not yesterday's, and not runs still going", () => {
    const db = openDb();
    const now = new Date("2026-10-15T23:30:00-04:00"); // 03:30 UTC on the 16th
    expect(utcDayStart(now)).toBe("2026-10-16T00:00:00.000Z");
    run(db, "2026-10-15T23:59:59.000Z", 10); // yesterday in UTC
    run(db, "2026-10-16T00:00:00.000Z", 1.25);
    run(db, "2026-10-16T03:00:00.000Z", 2.5);
    run(db, "2026-10-16T03:20:00.000Z", null); // still running
    expect(spentTodayUsd(db, now)).toBeCloseTo(3.75);
    expect(spentTodayUsd(openDb(), now)).toBe(0);
  });

  it("starts under the cap and stops once it is reached", () => {
    expect(autoReviewDecision(pushed, on, 4.99, false)).toEqual({ action: "start" });
    expect(autoReviewDecision(requested, on, 5, false)).toEqual({ action: "over-cap", spentUsd: 5 });
    expect(autoReviewDecision(pushed, { ...on, dailyCapUsd: 0 }, 0, false)).toEqual({ action: "over-cap", spentUsd: 0 });
  });
});

describe("auto-review setting", () => {
  it("is off by default and only follows the repositories switched on", () => {
    expect(defaultWatchSettings().autoReviewRepos).toEqual([]);
    expect(autoReviewDecision(pushed, defaultWatchSettings(), 0, false).action).toBe("ignore");
    expect(autoReviewDecision({ ...pushed, repo: "c/d" }, on, 0, false).action).toBe("ignore");
  });

  it("never starts on a reply, nor over a review already running", () => {
    expect(autoReviewDecision(reply, on, 0, false).action).toBe("ignore");
    expect(autoReviewDecision(pushed, on, 0, true).action).toBe("ignore");
  });

  it("starts nothing while the general switch is off, without forgetting the repositories", () => {
    expect(defaultWatchSettings().autoReviewPaused).toBe(false);
    const paused = { ...on, autoReviewPaused: true };
    expect(autoReviewDecision(pushed, paused, 0, false)).toEqual({ action: "ignore", reason: "auto-review is paused" });
    expect(autoReviewDecision(requested, paused, 0, false).action).toBe("ignore");
    expect(paused.autoReviewRepos).toEqual(["a/b"]);
  });

  it("skips a PR marked not to review, on every new push, until it is unmarked", () => {
    const muted = { ...on, autoReviewMutedPrs: ["a/b#1"] };
    expect(autoReviewDecision(pushed, muted, 0, false)).toEqual({ action: "ignore", reason: "auto-review is off for this PR" });
    expect(autoReviewDecision({ ...pushed, head: "ccc", reviewedHead: "bbb" }, muted, 0, false).action).toBe("ignore");
    expect(autoReviewDecision(requested, muted, 0, false)).toEqual({ action: "start" });
    expect(autoReviewDecision(pushed, { ...muted, autoReviewMutedPrs: [] }, 0, false)).toEqual({ action: "start" });
  });

  it("saves to the settings table and refuses unusable values", () => {
    const db = openDb();
    saveWatchSettings(db, { autoReviewRepos: ["a/b", "a/b"], dailyCapUsd: 2 });
    expect(getWatchSettings(db)).toMatchObject({ autoReviewRepos: ["a/b"], dailyCapUsd: 2, pollSeconds: 120 });
    expect(() => saveWatchSettings(db, { pollSeconds: 5 })).toThrow();
    expect(() => saveWatchSettings(db, { dailyCapUsd: -1 })).toThrow();
    expect(() => saveWatchSettings(db, { autoReviewRepos: ["not a repo"] })).toThrow();
    saveWatchSettings(db, { autoReviewPaused: true, autoReviewMutedPrs: ["a/b#3", "a/b#3"] });
    expect(getWatchSettings(db)).toMatchObject({ autoReviewPaused: true, autoReviewMutedPrs: ["a/b#3"] });
    expect(() => saveWatchSettings(db, { autoReviewMutedPrs: ["a/b"] })).toThrow();
  });
});
