import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSSE } from "./useSSE";
import { useGo } from "../nav";
import { fetchJson } from "../lib/api";
import type { DeskNotification, NotificationListDto, NotificationStreamEvent } from "../../../shared/types";

const supported = typeof window !== "undefined" && "Notification" in window;

export function useNotificationPermission(): [NotificationPermission | "unsupported", () => void] {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(supported ? Notification.permission : "unsupported");
  const request = useCallback(() => {
    void Notification.requestPermission().then(setPermission);
  }, []);
  return [permission, request];
}

// The unread count, shared by the rail badge and the list. The server owns it: every stream event carries it.
let unread = 0;
const listeners = new Set<() => void>();
function setUnread(n: number) {
  if (n === unread) return;
  unread = n;
  for (const l of listeners) l();
}

export function useUnreadCount(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unread
  );
}

/** Lists the notifications, then marks them read: the ones unread a moment ago keep readAt null in what is returned. */
export async function openNotificationList(limit = 50): Promise<DeskNotification[]> {
  const list = await fetchJson<NotificationListDto>(`/api/notifications?limit=${limit}`);
  const { unread: left } = await fetchJson<{ unread: number }>("/api/notifications/read", { method: "POST" });
  setUnread(left);
  return list.items;
}

/** What a click on a notification opens: its Desk screen, or GitHub for a reply (the Desk does not show replies). */
export function useOpenNotification() {
  const go = useGo();
  return useCallback(
    (n: DeskNotification) => {
      const target = n.target;
      if (n.kind === "comment-reply" && n.url) window.open(n.url, "_blank", "noopener");
      else if (target?.kind === "pr") go.pr(target.repo, target.number);
      else if (target?.kind === "local") go.localReview(target);
      else if (target?.kind === "compare") go.compareReview(target);
      else if (n.url) window.open(n.url, "_blank", "noopener");
    },
    [go]
  );
}

/** One system notification per Desk notification (reviews and GitHub events); a click opens it. Keeps the unread count live. */
export function useDeskNotifications() {
  const open = useOpenNotification();

  useEffect(() => {
    fetchJson<NotificationListDto>("/api/notifications?limit=1")
      .then((list) => setUnread(list.unread))
      .catch(() => {});
  }, []);

  useSSE("/api/notifications/stream", (data) => {
    const event = data as NotificationStreamEvent;
    setUnread(event.unread);
    if (event.type !== "notification" || !supported || Notification.permission !== "granted") return;
    const n = event.notification;
    // Same tag in every open tab: the system keeps one notification instead of stacking copies.
    const notification = new Notification(n.title, { body: n.body, tag: n.tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
      open(n);
    };
  });
}
