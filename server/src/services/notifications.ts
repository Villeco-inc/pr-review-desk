import { EventEmitter } from "node:events";
import type Database from "better-sqlite3";
import { getDb } from "../db/schema";
import { reviewOutcomes } from "./review-engine";
import type { WatchEvent } from "./github-watch";
import type { DeskNotification, DeskNotificationKind, NotificationStreamEvent, ReviewOutcome, ReviewTarget } from "../../../shared/types";

/** Every notification and every "list opened", for the SSE stream: emitted as "event" (NotificationStreamEvent). */
export const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0);

export interface NewNotification {
  kind: DeskNotificationKind;
  title: string;
  body: string;
  tag: string;
  url?: string | null;
  target?: ReviewTarget | null;
}

interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  tag: string;
  url: string | null;
  target: string | null;
  created_at: string;
  read_at: string | null;
}

const toDto = (row: NotificationRow): DeskNotification => ({
  id: row.id,
  kind: row.kind as DeskNotificationKind,
  title: row.title,
  body: row.body,
  tag: row.tag,
  url: row.url,
  target: row.target ? (JSON.parse(row.target) as ReviewTarget) : null,
  createdAt: row.created_at,
  readAt: row.read_at,
});

// A push or a reply is one event forever, its tag names it (head sha, comment id): seen again within a
// day (the PR closed and reopened), it is not news. A review request may come back for real (re-requested).
const GITHUB_DEDUPE_MS = 24 * 60 * 60_000;
const GITHUB_KINDS = new Set<DeskNotificationKind>(["new-commits", "comment-reply"]);

/** Records a notification; null when it repeats a push or a reply already recorded within a day. */
export function insertNotification(db: Database.Database, n: NewNotification, now = new Date()): DeskNotification | null {
  if (GITHUB_KINDS.has(n.kind)) {
    const since = new Date(now.getTime() - GITHUB_DEDUPE_MS).toISOString();
    if (db.prepare("SELECT 1 FROM notifications WHERE tag = ? AND created_at >= ?").get(n.tag, since)) return null;
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO notifications (kind, title, body, tag, url, target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(n.kind, n.title, n.body, n.tag, n.url ?? null, n.target ? JSON.stringify(n.target) : null, now.toISOString());
  return toDto(db.prepare("SELECT * FROM notifications WHERE id = ?").get(lastInsertRowid) as NotificationRow);
}

export function listNotifications(db: Database.Database, limit = 50): DeskNotification[] {
  return (db.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT ?").all(limit) as NotificationRow[]).map(toDto);
}

export function unreadCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL").get() as { n: number }).n;
}

export function markAllRead(db: Database.Database, now = new Date()): number {
  return db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").run(now.toISOString()).changes;
}

/** Records a notification and pushes it to every open tab. */
export function notify(n: NewNotification): DeskNotification | null {
  const db = getDb();
  const notification = insertNotification(db, n);
  if (notification) {
    console.log(`[notifications] ${notification.kind}: ${notification.title} — ${notification.body}`);
    notificationEvents.emit("event", { type: "notification", notification, unread: unreadCount(db) } satisfies NotificationStreamEvent);
  }
  return notification;
}

export function readAll(): number {
  const db = getDb();
  const changed = markAllRead(db);
  notificationEvents.emit("event", { type: "read", unread: unreadCount(db) } satisfies NotificationStreamEvent);
  return changed;
}

export function outcomeNotification(outcome: ReviewOutcome): NewNotification {
  return {
    kind: outcome.status === "reported" ? "review-reported" : "review-failed",
    title: outcome.title,
    body:
      outcome.status === "reported"
        ? `Review finished — ${outcome.findings ?? 0} finding${outcome.findings === 1 ? "" : "s"}`
        : `Review failed — ${outcome.error ?? "unknown error"}`,
    tag: `${outcome.reviewId}:${outcome.status}`,
    target: outcome.target,
  };
}

const firstLine = (text: string, max = 140) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export function watchEventNotification(event: WatchEvent): NewNotification {
  const title = [`${event.repo}#${event.number}`, event.title].filter(Boolean).join(" — ");
  const target: ReviewTarget = { kind: "pr", repo: event.repo, number: event.number };
  switch (event.kind) {
    case "review-requested":
      return { kind: event.kind, title, body: `Your review is requested${event.author ? ` (opened by ${event.author})` : ""}`, tag: `requested:${event.repo}#${event.number}`, url: event.url, target };
    case "new-commits":
      return { kind: event.kind, title, body: `New commits since the Desk's review — now at ${event.head.slice(0, 7)}`, tag: `pushed:${event.repo}#${event.number}:${event.head}`, url: event.url, target };
    case "comment-reply":
      return { kind: event.kind, title, body: `${event.author} replied: ${firstLine(event.body)}`, tag: `reply:${event.commentId}`, url: event.url, target };
  }
}

let started = false;

/** Turns every review outcome into a notification. review-engine.ts keeps announcing; this only listens. */
export function startReviewOutcomeNotifications(): void {
  if (started) return;
  started = true;
  reviewOutcomes.on("outcome", (outcome: ReviewOutcome) => notify(outcomeNotification(outcome)));
}
