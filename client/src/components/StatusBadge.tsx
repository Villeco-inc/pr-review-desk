import type { MyReviewState } from "../../../shared/types";

const LABELS: Record<string, string> = { none: "No review", queued: "Queued", running: "Running", reported: "Reported", failed: "Failed", cancelled: "Cancelled" };

// No dot, no ping — the fill is the signal.
const STYLES: Record<string, string> = {
  none: "bg-st-none-bg text-st-none-fg",
  queued: "bg-st-queued-bg text-st-queued-fg",
  running: "bg-st-running-bg text-st-running-fg",
  reported: "bg-st-reported-bg text-st-reported-fg",
  failed: "bg-st-failed-bg text-st-failed-fg",
  cancelled: "bg-st-none-bg text-st-none-fg",
};

const BLOCK = "inline-flex items-center whitespace-nowrap edge px-2 label-caps text-[length:calc(11px*var(--font-scale))] tracking-[.07em] leading-none";

export default function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STYLES[status] ?? STYLES.none;
  return <span className={`${BLOCK} h-[26px] ${s}`}>{label ?? LABELS[status] ?? status}</span>;
}

export function FindingStateBadge({ state }: { state: string }) {
  const cls =
    state === "posted"
      ? "bg-st-reported-bg text-st-reported-fg"
      : state === "dismissed"
      ? "bg-subtle text-fg-3 line-through"
      : state === "resolved"
      ? "bg-success-soft text-success-ink"
      : "bg-surface text-fg";
  return <span className={`${BLOCK} h-[22px] ${cls}`}>{state}</span>;
}

const FOLLOWUP: Record<string, { label: string; cls: string }> = {
  resolved: { label: "fixed", cls: "text-success-ink" },
  still_present: { label: "still there", cls: "text-warn-ink" },
  unclear: { label: "unclear", cls: "text-fg-3" },
};

/** What a later run said about an earlier finding. An open one judged fixed already reads as the resolved state. */
export function FollowupBadge({ status, state }: { status: string | null; state: string }) {
  const f = status && !(status === "resolved" && state === "resolved") ? FOLLOWUP[status] : undefined;
  return f ? <span className={`shrink-0 label-caps ${f.cls}`}>{f.label}</span> : null;
}

const MY_REVIEW: Record<MyReviewState, { label: string; cls: string }> = {
  APPROVED: { label: "Approved", cls: "bg-st-reported-bg text-st-reported-fg" },
  CHANGES_REQUESTED: { label: "Changes", cls: "bg-st-failed-bg text-st-failed-fg" },
  COMMENTED: { label: "Commented", cls: "bg-st-none-bg text-st-none-fg" },
};

/** The viewer's own GitHub review on a PR, as opposed to StatusBadge (our AI review). */
export function MyReviewBadge({ state, isAuthor }: { state: MyReviewState | null; isAuthor: boolean }) {
  if (isAuthor) return <span className="label-caps text-fg-3">Author</span>;
  if (!state) return <span className="text-fg-3">—</span>;
  const s = MY_REVIEW[state];
  return <span className={`${BLOCK} h-[26px] ${s.cls}`}>{s.label}</span>;
}
