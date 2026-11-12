import { useEffect, useState } from "react";
import Button from "./ui/Button";
import Icon, { type IconName } from "./ui/Icon";
import Skeleton from "./ui/Skeleton";
import { Segmented } from "./ui/Field";
import { useToast } from "./ui/Toast";
import WatchSettingsForm from "./WatchSettingsForm";
import { openNotificationList, useOpenNotification } from "../hooks/useNotifications";
import { fetchJson } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { DeskNotification, DeskNotificationKind } from "../../../shared/types";

const KIND: Record<DeskNotificationKind, { icon: IconName; label: string; tone: string }> = {
  "review-reported": { icon: "checkCircle", label: "Review done", tone: "text-success-ink" },
  "review-failed": { icon: "alert", label: "Review failed", tone: "text-danger-ink" },
  "review-requested": { icon: "pullRequest", label: "Review requested", tone: "text-fg" },
  "new-commits": { icon: "branch", label: "New commits", tone: "text-fg" },
  "comment-reply": { icon: "send", label: "Reply", tone: "text-fg" },
  "auto-review-started": { icon: "play", label: "Auto-review", tone: "text-fg" },
  "auto-review-skipped": { icon: "gauge", label: "Auto-review skipped", tone: "text-warn-ink" },
};

const TABS: { value: "recent" | "settings"; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "settings", label: "Settings" },
];

/** The recent notifications. Opening it marks them all read; the ones that were unread keep a marker while it stays open. */
export default function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<DeskNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [tab, setTab] = useState<"recent" | "settings">("recent");
  const open = useOpenNotification();
  const { toast } = useToast();

  const load = () => {
    setError(null);
    openNotificationList()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, []);

  const pollNow = async () => {
    setPolling(true);
    try {
      const { events } = await fetchJson<{ events: number }>("/api/notifications/poll", { method: "POST" });
      toast({ kind: "success", message: events === 0 ? "Nothing new on GitHub" : `${events} new event${events === 1 ? "" : "s"} on GitHub` });
      load();
    } catch (err) {
      toast({ kind: "error", message: `Could not check GitHub: ${(err as Error).message}` });
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-fg/40 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        className="flex max-h-[76vh] w-full max-w-[620px] flex-col edge bg-surface lift"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex shrink-0 items-center gap-3 edge-b px-5 py-4">
          <h2 id="notifications-title" className="font-display text-[length:calc(22px*var(--font-scale))] uppercase leading-none">
            Notifications
          </h2>
          <div className="ml-auto">
            <Segmented ariaLabel="Notifications view" value={tab} onChange={setTab} options={TABS} />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-fg-3 hover:text-fg focus-ring" autoFocus>
            <Icon name="x" className="size-4" />
          </button>
        </div>

        {tab === "settings" ? (
          <div className="min-h-[120px] flex-1 overflow-y-auto">
            <WatchSettingsForm />
          </div>
        ) : (
          <>
            <RecentList
              items={items}
              error={error}
              onRetry={load}
              onOpen={(n) => {
                open(n);
                onClose();
              }}
            />
            <div className="flex shrink-0 items-center gap-3 edge-t bg-subtle px-5 py-3">
              <span className="label-caps text-fg-2">{items ? `${items.length} recent` : "…"}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button onClick={pollNow} disabled={polling}>
                  <Icon name="refresh" />
                  {polling ? "Checking…" : "Check GitHub now"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RecentList({
  items,
  error,
  onRetry,
  onOpen,
}: {
  items: DeskNotification[] | null;
  error: string | null;
  onRetry: () => void;
  onOpen: (n: DeskNotification) => void;
}) {
  return (
    <div role="list" aria-label="Recent notifications" className="min-h-[120px] flex-1 overflow-y-auto">
      {error ? (
        <div role="alert" className="flex flex-col items-start gap-3 p-5">
          <span className="font-medium">Could not load the notifications</span>
          <span className="font-mono text-xs text-danger-ink">{error}</span>
          <Button size="sm" onClick={onRetry}>
            <Icon name="refresh" />
            Retry
          </Button>
        </div>
      ) : !items ? (
        <div className="flex flex-col gap-3 p-5" aria-label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5 w-2/3" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-6 text-center text-fg-2">Nothing yet. Review outcomes, review requests, pushes on reviewed PRs and replies to the Desk's comments land here.</div>
      ) : (
        items.map((n) => {
          const kind = KIND[n.kind] ?? KIND["review-reported"];
          return (
            <div key={n.id} role="listitem" className="edge-soft-b last:border-b-0">
              <button type="button" onClick={() => onOpen(n)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-row-hover focus-ring">
                <Icon name={kind.icon} className={`mt-0.5 size-4 shrink-0 ${kind.tone}`} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="label-caps text-fg-3">{kind.label}</span>
                    {n.readAt === null && <span className="bg-acid px-1 font-mono text-[length:calc(10px*var(--font-scale))] leading-[calc(14px*var(--font-scale))] text-acid-fg">NEW</span>}
                    <span className="ml-auto shrink-0 font-mono text-[length:calc(11px*var(--font-scale))] text-fg-3" title={new Date(n.createdAt).toLocaleString()}>
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  <span className="truncate font-mono text-[length:calc(13px*var(--font-scale))] font-medium">{n.title}</span>
                  <span className="line-clamp-2 text-fg-2">{n.body}</span>
                </span>
                {n.kind === "comment-reply" && <Icon name="external" className="mt-0.5 size-3.5 shrink-0 text-fg-3" />}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
