import { useCallback, useMemo } from "react";
import { useQuery } from "../hooks/useApi";
import { useStoredState } from "../lib/storage";
import NotFound from "./ui/NotFound";
import { ReimportButton, SessionButton } from "./RunSession";
import { useSSE } from "../hooks/useSSE";
import type { FindingDto, ReviewDto } from "../../../shared/types";
import SeverityBadge from "./SeverityBadge";
import StatusBadge, { FindingStateBadge } from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Band, Chip } from "./ui/Card";
import Icon from "./ui/Icon";
import Skeleton, { CardSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { relativeTime } from "../lib/format";
import { ShellActions } from "./AppShell";
import { useHotkeys } from "../hooks/useHotkeys";

interface ReviewWithFindings extends ReviewDto {
  findings: FindingDto[];
}

const SEVERITY_ORDER: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3, nit: 4 };
const SEVERITIES = ["blocker", "high", "medium", "low", "nit"] as const;

export default function LocalReviewDetail({
  repo,
  number,
  repoLabel,
  branch,
  base,
  onBack,
  onSelectFinding,
  onOpenSession,
  backLabel = "All branches",
}: {
  repo: string;
  number: number;
  repoLabel: string;
  branch: string;
  base: string;
  onBack: () => void;
  onSelectFinding: (id: string) => void;
  onOpenSession: (runId: string) => void;
  /** Where Esc and the back button go: the branch list, or the compare screen. */
  backLabel?: string;
}) {
  // The open thread survives a refresh, in this tab only.
  const [view, setView] = useStoredState("session", `prd:view:local:${repo}#${number}`, { thread: false });
  const showThread = view.thread;
  const setShowThread = (thread: boolean) => setView({ thread });
  const { toast } = useToast();

  const {
    data: reviewData,
    error: reviewError,
    loading: reviewLoading,
    refetch: refetchReview,
  } = useQuery<{ review: ReviewDto; findings: FindingDto[] }>(`/api/reviews/${repo}/${number}`, [repo, number]);
  const review: ReviewWithFindings | null = reviewData ? { ...reviewData.review, findings: reviewData.findings } : null;

  const { data: threadData, refetch: refetchThread } = useQuery<{ log: string[] }>(
    showThread ? `/api/reviews/${repo}/${number}/thread` : null,
    [showThread, review?.status]
  );

  const isRunning = review?.status === "running" || review?.status === "queued";

  const handleSSEMessage = useCallback(() => {
    refetchReview();
  }, [refetchReview]);

  useSSE(isRunning ? `/api/reviews/${repo}/${number}/events` : null, handleSSEMessage);

  const sortedFindings = useMemo(
    () => [...(review?.findings ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [review]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of sortedFindings) c[f.severity] = (c[f.severity] ?? 0) + 1;
    return c;
  }, [sortedFindings]);

  const openFindings = sortedFindings.filter((f) => f.state === "open");

  const buildFixPrompt = () => {
    if (openFindings.length === 0) return "";
    const items = openFindings.map((f, i) => {
      const loc = `${f.file}${f.startLine ? `:${f.startLine}` : ""}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ""}`;
      return [
        `## ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`,
        `**File:** \`${loc}\``,
        f.problem ? `**Problem:** ${f.problem}` : "",
        f.suggestedFix ? `**Fix:** ${f.suggestedFix}` : "",
      ].filter(Boolean).join("\n");
    });

    return [
      `Fix the following ${openFindings.length} code review finding${openFindings.length > 1 ? "s" : ""} on branch \`${branch}\`:`,
      "",
      ...items,
      "",
      "Apply each fix. If a suggested fix is unclear, use your best judgment based on the problem description. Do not change unrelated code.",
    ].join("\n");
  };

  const handleCopyPrompt = async () => {
    const prompt = buildFixPrompt();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast({ kind: "success", message: "Fix prompt copied to clipboard" });
    } catch {
      toast({ kind: "error", message: "Could not copy to clipboard" });
    }
  };

  useHotkeys({ Escape: onBack });

  if (reviewError && !reviewData) {
    return <NotFound title="Review not found" detail={`${repoLabel} · ${branch}: ${reviewError}`} backLabel={backLabel} onBack={onBack} />;
  }

  return (
    <main className="flex flex-col gap-4 px-10 pb-10 pt-5">
      <ShellActions>
        {review && <StatusBadge status={review.status} />}
        <Button size="sm" onClick={onBack} aria-keyshortcuts="Escape" title={`${backLabel} (Esc)`}>
          <Icon name="arrowLeft" />
          {backLabel}
        </Button>
      </ShellActions>

      <Card className="overflow-hidden">
        <div className="flex items-start gap-4 px-5 pb-4 pt-[18px]">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {review ? (
              <h1 className="text-xl font-bold leading-[28px] tracking-[-0.015em]">{review.title}</h1>
            ) : (
              <Skeleton className="h-5 w-[480px]" />
            )}
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-fg-3">
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Icon name="repo" className="size-3.5 text-fg-3" />
                {repoLabel}
              </span>
              <Dot />
              <span className="inline-flex items-center gap-1.5">
                <Icon name="branch" className="size-3.5 text-fg-3" />
                <Chip mono>{branch}</Chip>
                <Icon name="arrowRight" className="size-3 text-fg-3" />
                <Chip mono>{base}</Chip>
              </span>
            </div>
          </div>
          {review && <SessionButton repo={repo} number={number} status={review.status} onOpen={onOpenSession} />}
          {review && (
            <Button
              variant={showThread ? "plain" : "quiet"}
              onClick={() => {
                setShowThread(!showThread);
                if (!showThread) refetchThread();
              }}
            >
              <Icon name="terminal" />
              Thread
              {threadData && <Chip mono>{threadData.log.length}</Chip>}
              <Icon name={showThread ? "chevronUp" : "chevronDown"} />
            </Button>
          )}
        </div>

        {review?.status === "failed" && review.error && (
          <div role="alert" className="flex flex-col edge-t bg-danger-soft">
            <Band tone="problem">
              <Icon name="alert" className="size-3.5" />
              Review failed
            </Band>
            <div className="mx-5 mb-4 mt-3.5 flex items-start gap-3.5">
              <pre className="max-w-[900px] flex-1 whitespace-pre-wrap edge bg-surface px-2.5 py-2 font-mono text-xs leading-[18px] text-danger-ink">{review.error}</pre>
              <ReimportButton repo={repo} number={number} error={review.error} onDone={refetchReview} />
            </div>
          </div>
        )}

        {review?.summary && review.status === "reported" && (
          <div className="flex flex-col edge-t">
            <Band tone="summary">
              <Icon name="checkCircle" className="size-3.5" />
              Review summary
            </Band>
            <p className="max-w-[960px] whitespace-pre-wrap px-5 pb-4 pt-3 text-fg-2">{review.summary}</p>
          </div>
        )}
      </Card>

      {/* The fix prompt is the whole point of the local track, so it gets its own band. */}
      {openFindings.length > 0 && (
        <div className="flex items-center gap-4 edge bg-acid px-5 py-3.5 text-acid-fg lift">
          <Icon name="terminal" className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-display text-[20px] uppercase leading-none">Hand it to your agent</span>
            <span>
              One prompt covering the {openFindings.length} open finding{openFindings.length > 1 ? "s" : ""} on <span className="font-mono">{branch}</span>.
            </span>
          </div>
          <Button variant="primary" onClick={handleCopyPrompt}>
            <Icon name="terminal" />
            Copy fix prompt
          </Button>
        </div>
      )}

      {showThread && (
        <section className="overflow-hidden edge bg-term-bg lift font-mono text-xs leading-5 text-term-fg">
          <div className="flex h-[38px] items-center gap-2.5 edge-term-b pl-3.5 pr-3 font-sans text-xs text-term-head">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="terminal" className="size-3.5" />
              Review thread
            </span>
            <span className="font-mono text-term-muted">{threadData ? `${threadData.log.length} entries` : "loading…"}</span>
            <Button variant="quiet" size="sm" className="ml-auto text-term-head hover:bg-term-border hover:text-term-fg" onClick={() => refetchThread()}>
              <Icon name="refresh" />
              Refresh
            </Button>
          </div>
          <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto px-3.5 pb-3 pt-2.5">
            {threadData?.log.length === 0 && <div className="text-term-muted">No entries yet.</div>}
            {threadData?.log.map((entry, i) => {
              const cls = entry.startsWith("[tool]") ? "text-term-tool" : entry.startsWith("[result]") ? "text-term-muted" : "text-term-fg";
              return (
                <div key={i} className={`flex gap-3 ${cls}`}>
                  <span className="w-[22px] shrink-0 select-none text-right text-term-line">{i + 1}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{entry.length > 600 ? entry.slice(0, 600) + "…" : entry}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {reviewLoading && !review && <CardSkeleton lines={3} />}

      {review && (
        <Card className="overflow-hidden">
          <div className="flex h-12 items-center gap-3 edge-b pl-5 pr-4">
            <span className="font-display text-[20px] uppercase leading-none">Findings</span>
            <span className="font-mono text-xs text-fg-3">{sortedFindings.length}</span>
            {sortedFindings.length > 0 && (
              <span className="ml-1 inline-flex gap-2">
                {SEVERITIES.filter((s) => counts[s]).map((s) => (
                  <SeverityBadge key={s} severity={s} count={counts[s]} className="h-[22px] px-[7px]" />
                ))}
              </span>
            )}
            {openFindings.length > 0 && (
              <Button size="sm" className="ml-auto" onClick={handleCopyPrompt}>
                <Icon name="terminal" />
                Copy fix prompt
              </Button>
            )}
          </div>

          <div className="flex flex-col">
            {sortedFindings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelectFinding(finding.id)}
                className="group flex h-13 w-full items-center gap-3 edge-soft-b pl-5 pr-4 text-left outline-none last:border-b-0 hover:bg-row-hover focus-visible:bg-row-hover focus-visible:shadow-[inset_5px_0_0_var(--color-primary)]"
              >
                <SeverityBadge severity={finding.severity} className="w-[84px] justify-center" />
                <span className="w-[300px] shrink-0 truncate font-mono text-xs text-fg-3" title={finding.file}>
                  {finding.file}:{finding.startLine ?? "?"}
                </span>
                <span className={`min-w-0 flex-1 truncate font-medium ${finding.state === "dismissed" ? "text-fg-3" : ""}`}>{finding.title}</span>
                <FindingStateBadge state={finding.state} />
                <Icon name="chevronRight" className="size-4 text-fg-3 group-hover:text-fg" />
              </button>
            ))}
            {sortedFindings.length === 0 && (
              <div className="flex items-center gap-3 p-5 text-fg-2">
                <Icon name="inbox" className="size-4 text-fg-3" />
                {isRunning ? "Findings will appear here as the review progresses." : review.status === "failed" ? "No findings recorded. Retry the review to populate this list." : "No findings."}
              </div>
            )}
          </div>
        </Card>
      )}

      {review && (
        <span className="font-mono text-xs text-fg-3">Updated {relativeTime(review.updatedAt)}</span>
      )}
    </main>
  );
}

function Dot() {
  return <span className="text-fg-3">·</span>;
}
