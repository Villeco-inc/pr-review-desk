import type Database from "better-sqlite3";
import type { WatchSettings } from "../../../shared/types";

// GitHub polling and automatic review settings, one JSON value in the settings table.

const KEY = "watch_settings";
export const MIN_POLL_SECONDS = 30;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const PR_KEY = /^[\w.-]+\/[\w.-]+#\d+$/;

export function defaultWatchSettings(): WatchSettings {
  const fromEnv = Number(process.env.GITHUB_POLL_SECONDS);
  return {
    pollSeconds: Number.isFinite(fromEnv) && fromEnv >= MIN_POLL_SECONDS ? fromEnv : 120,
    autoReviewRepos: [],
    autoReviewPaused: false,
    autoReviewMutedPrs: [],
    dailyCapUsd: 5,
    autoReviewModel: "sonnet",
    autoReviewEffort: "standard",
  };
}

export function getWatchSettings(db: Database.Database): WatchSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return { ...defaultWatchSettings(), ...(row ? (JSON.parse(row.value) as Partial<WatchSettings>) : {}) };
}

/** Merges a partial change into the saved settings; throws on a value that cannot be used. */
export function saveWatchSettings(db: Database.Database, patch: Partial<WatchSettings>): WatchSettings {
  const next = { ...getWatchSettings(db), ...patch };
  if (!Number.isFinite(next.pollSeconds) || next.pollSeconds < MIN_POLL_SECONDS) throw new Error(`pollSeconds must be at least ${MIN_POLL_SECONDS}`);
  if (!Number.isFinite(next.dailyCapUsd) || next.dailyCapUsd < 0) throw new Error("dailyCapUsd must be zero or more");
  if (!Array.isArray(next.autoReviewRepos) || !next.autoReviewRepos.every((r) => typeof r === "string" && REPO_NAME.test(r))) {
    throw new Error("autoReviewRepos must be a list of owner/name");
  }
  if (!Array.isArray(next.autoReviewMutedPrs) || !next.autoReviewMutedPrs.every((p) => typeof p === "string" && PR_KEY.test(p))) {
    throw new Error("autoReviewMutedPrs must be a list of owner/name#number");
  }
  next.autoReviewPaused = next.autoReviewPaused === true;
  next.autoReviewRepos = [...new Set(next.autoReviewRepos)];
  next.autoReviewMutedPrs = [...new Set(next.autoReviewMutedPrs)];
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(next));
  return next;
}
