import type Database from "better-sqlite3";
import { getDb } from "../db/schema";
import { reviewId, startReview } from "./review-engine";
import { notify } from "./notifications";
import { getWatchSettings } from "./watch-settings";
import type { WatchEvent } from "./github-watch";
import type { WatchSettings } from "../../../shared/types";

// Automatic review: a review request or a push on a reviewed PR starts a review by itself, on the
// repositories where it is switched on, until today's runs (UTC) have cost the daily cap.

/** Midnight UTC of the day `now` falls in, as stored in review_runs.started_at. */
export function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** What today's runs cost so far. A run still going has no cost yet and counts for nothing until it ends. */
export function spentTodayUsd(db: Database.Database, now = new Date()): number {
  const row = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM review_runs WHERE started_at >= ?").get(utcDayStart(now)) as { spent: number };
  return row.spent;
}

export type AutoReviewDecision = { action: "ignore"; reason: string } | { action: "over-cap"; spentUsd: number } | { action: "start" };

export function autoReviewDecision(event: WatchEvent, settings: WatchSettings, spentUsd: number, reviewRunning: boolean): AutoReviewDecision {
  if (event.kind !== "review-requested" && event.kind !== "new-commits") return { action: "ignore", reason: "not a review trigger" };
  if (!settings.autoReviewRepos.includes(event.repo)) return { action: "ignore", reason: "auto-review is off for this repository" };
  if (settings.autoReviewPaused) return { action: "ignore", reason: "auto-review is paused" };
  if (settings.autoReviewMutedPrs.includes(`${event.repo}#${event.number}`)) return { action: "ignore", reason: "auto-review is off for this PR" };
  if (reviewRunning) return { action: "ignore", reason: "a review of this PR is already running" };
  if (spentUsd >= settings.dailyCapUsd) return { action: "over-cap", spentUsd };
  return { action: "start" };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export async function handleAutoReview(event: WatchEvent): Promise<void> {
  if (event.kind === "comment-reply") return;
  const db = getDb();
  const settings = getWatchSettings(db);
  const running = !!db.prepare("SELECT 1 FROM reviews WHERE id = ? AND status IN ('queued', 'running')").get(reviewId(event.repo, event.number));
  const decision = autoReviewDecision(event, settings, spentTodayUsd(db), running);
  const title = [`${event.repo}#${event.number}`, event.title].filter(Boolean).join(" — ");
  const target = { kind: "pr" as const, repo: event.repo, number: event.number };

  if (decision.action === "ignore") {
    if (settings.autoReviewRepos.includes(event.repo)) console.log(`[auto-review] ${event.repo}#${event.number}: ${decision.reason}`);
    return;
  }
  if (decision.action === "over-cap") {
    notify({
      kind: "auto-review-skipped",
      title,
      body: `No automatic review: today's reviews cost ${usd(decision.spentUsd)}, the daily cap is ${usd(settings.dailyCapUsd)}`,
      tag: `auto-skipped:${event.repo}#${event.number}:${event.kind === "new-commits" ? event.head : "requested"}`,
      url: event.url,
      target,
    });
    return;
  }

  const why = event.kind === "review-requested" ? "your review was requested" : `new commits (${event.head.slice(0, 7)})`;
  try {
    await startReview(event.repo, event.number, [], settings.autoReviewModel ?? undefined, settings.autoReviewEffort ?? undefined);
    notify({
      kind: "auto-review-started",
      title,
      body: `Automatic review started — ${why} · ${settings.autoReviewModel ?? "default model"}, ${settings.autoReviewEffort ?? "standard"}`,
      tag: `auto-started:${event.repo}#${event.number}:${event.kind === "new-commits" ? event.head : "requested"}`,
      url: event.url,
      target,
    });
  } catch (err) {
    notify({ kind: "auto-review-skipped", title, body: `Automatic review could not start — ${(err as Error).message}`, tag: `auto-failed:${event.repo}#${event.number}`, url: event.url, target });
  }
}
