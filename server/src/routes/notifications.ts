import { Router } from "express";
import { getDb } from "../db/schema";
import { listNotifications, notificationEvents, readAll, unreadCount } from "../services/notifications";
import { pollNow } from "../services/github-poller";
import { getWatchSettings, saveWatchSettings } from "../services/watch-settings";
import { spentTodayUsd } from "../services/auto-review";
import type { NotificationListDto, NotificationStreamEvent, WatchSettings, WatchSettingsDto } from "../../../shared/types";

export const notificationsRouter = Router();

notificationsRouter.get("/notifications", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const db = getDb();
  res.json({ items: listNotifications(db, limit), unread: unreadCount(db) } satisfies NotificationListDto);
});

/** Opening the list reads everything in it. */
notificationsRouter.post("/notifications/read", (_req, res) => {
  readAll();
  res.json({ unread: unreadCount(getDb()) });
});

/** The single live stream every tab listens to: new notifications and unread-count changes. */
notificationsRouter.get("/notifications/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const listener = (event: NotificationStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  notificationEvents.on("event", listener);
  req.on("close", () => notificationEvents.off("event", listener));
});

/** Polls GitHub now instead of waiting for the next round. */
notificationsRouter.post("/notifications/poll", async (_req, res) => {
  const events = await pollNow();
  res.json({ events: events.length });
});

notificationsRouter.get("/notifications/settings", (_req, res) => {
  const db = getDb();
  res.json({ ...getWatchSettings(db), spentTodayUsd: spentTodayUsd(db) } satisfies WatchSettingsDto);
});

notificationsRouter.put("/notifications/settings", (req, res) => {
  try {
    const db = getDb();
    res.json({ ...saveWatchSettings(db, req.body as Partial<WatchSettings>), spentTodayUsd: spentTodayUsd(db) } satisfies WatchSettingsDto);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
