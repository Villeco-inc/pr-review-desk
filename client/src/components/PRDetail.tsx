import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { FindingDto, ReviewDto } from "../../../shared/types";

interface PrSnapshotFile {
  path: string;
  additions?: number;
  deletions?: number;
}

interface PrSnapshotResponse {
  snapshot: {
    title: string;
    author?: { login?: string; name?: string } | null;
    isDraft: boolean;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
    state: string;
    files?: PrSnapshotFile[];
  };
  review: ReviewDto | null;
}
import SeverityBadge from "./SeverityBadge";
import StatusBadge, { FindingStateBadge } from "./StatusBadge";
import Button, { LinkButton } from "./ui/Button";
import Card, { Band, Chip } from "./ui/Card";
import { Checkbox, Input, Select } from "./ui/Field";
import Icon from "./ui/Icon";
import Avatar from "./ui/Avatar";
import Skeleton, { CardSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { formatCount, relativeTime } from "../lib/format";
import { ShellActions } from "./AppShell";
import Pager from "./ui/Pager";
import { focusedAttr, useHotkeys } from "../hooks/useHotkeys";
import { LAUNCH_DEFAULTS, LAUNCH_KEY, useStoredState } from "../lib/storage";
import { loadPrOrder } from "../lib/url-state";
import NotFound from "./ui/NotFound";
import { ReimportButton, ScopeNote, SessionButton } from "./RunSession";

interface ReviewWithFindings extends ReviewDto {
  findings: FindingDto[];
}

const SEVERITY_ORDER: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3, nit: 4 };
const SEVERITIES = ["blocker", "high", "medium", "low", "nit"] as const;

export default function PRDetail({
  repo,
  number,
  onSelectPR,
  onBack,
  onSelectFinding,
  onOpenSession,
}: {
  repo: string;
  number: number;
  onSelectPR: (repo: string, number: number) => void;
  onBack: () => void;
  onSelectFinding: (id: string) => void;
  onOpenSession: (runId: string) => void;
}) {
  const [launch, setLaunch] = useStoredState("local", LAUNCH_KEY, LAUNCH_DEFAULTS);
  const { model, effort, skills: skillsInput } = launch;
  const setModel = (model: string) => setLaunch((l) => ({ ...l, model }));
  const setEffort = (effort: string) => setLaunch((l) => ({ ...l, effort }));
  const setSkillsInput = (skills: string) => setLaunch((l) => ({ ...l, skills }));
  // What this screen was showing survives a refresh, in this tab only.
  const [view, setView] = useStoredState("session", `prd:view:pr:${repo}#${number}`, { thread: false, selected: [] as string[] });
  const showThread = view.thread;
  const setShowThread = (thread: boolean) => setView((v) => ({ ...v, thread }));
  const selected = useMemo(() => new Set(view.selected), [view.selected]);
  const setSelected = (update: (prev: Set<string>) => Set<string>) => setView((v) => ({ ...v, selected: [...update(new Set(v.selected))] }));
  // The PR list in the order the user saw it, taken when they clicked; drives the pager.
  const [order] = useState(loadPrOrder);
  const { toast } = useToast();

  const { data: prData, error: prError } = useQuery<PrSnapshotResponse>(`/api/prs/${repo}/${number}`);
  const pr = useMemo(() => {
    if (!prData?.snapshot) return null;
    const s = prData.snapshot;
    const files = s.files ?? [];
    return {
      title: s.title,
      author: s.author?.login ?? s.author?.name ?? "",
      isDraft: s.isDraft,
      baseRefName: s.baseRefName,
      headRefName: s.headRefName,
      additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
      deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
      changedFiles: files.length,
      url: `https://github.com/${repo}/pull/${number}`,
    };
  }, [prData, repo, number]);
  const {
    data: review,
    loading: reviewLoading,
    refetch: refetchReview,
  } = useQuery<ReviewWithFindings | null>(`/api/reviews/latest?repo=${encodeURIComponent(repo)}&number=${number}`, [repo, number]);

  const { data: threadData, refetch: refetchThread } = useQuery<{ log: string[] }>(
    showThread ? `/api/reviews/${repo}/${number}/thread` : null,
    [showThread, review?.status]
  );

  const startReview = useMutation<ReviewDto>("/api/reviews", "POST");
  const postFinding = useMutation<{ url: string }>("__post__", "POST");
  const postAll = useMutation<{ posted: number }>("__postall__", "POST");

  const githubUrl = `https://github.com/${repo}/pull/${number}`;
  const isRunning = review?.status === "running" || review?.status === "queued";

  const handleSSEMessage = useCallback(() => {
    refetchReview();
  }, [refetchReview]);

  useSSE(isRunning ? `/api/reviews/${repo}/${number}/events` : null, handleSSEMessage);

  const handleStartReview = async () => {
    const skills = skillsInput.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await startReview.mutate({ repo, number, skills, model, effort });
      refetchReview();
    } catch (err) {
      toast({ kind: "error", message: `Could not start review: ${(err as Error).message}` });
    }
  };

  const sortedFindings = useMemo(
    () => [...(review?.findings ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [review]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of sortedFindings) c[f.severity] = (c[f.severity] ?? 0) + 1;
    return c;
  }, [sortedFindings]);
  const openCount = sortedFindings.filter((f) => f.state === "open").length;

  // A checked finding that was posted, dismissed or removed since is dropped from the selection.
  useEffect(() => {
    if (!review) return;
    const open = new Set(sortedFindings.filter((f) => f.state === "open").map((f) => f.id));
    if (view.selected.some((id) => !open.has(id))) setSelected((prev) => new Set([...prev].filter((id) => open.has(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, sortedFindings]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePostSelected = async () => {
    let posted = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        await postFinding.mutate({ mode: "inline" }, `/api/findings/${id}/post`);
        posted++;
      } catch {
        failed++;
      }
    }
    setSelected(() => new Set());
    refetchReview();
    if (posted) toast({ kind: "success", message: `Posted ${posted} comment${posted > 1 ? "s" : ""} on #${number}`, link: { href: githubUrl, label: "View" } });
    if (failed) toast({ kind: "error", message: `${failed} comment${failed > 1 ? "s" : ""} failed to post` });
  };

  const handlePostAllOpen = async () => {
    try {
      const res = await postAll.mutate({}, `/api/reviews/${repo}/${number}/post-all`);
      refetchReview();
      toast({ kind: "success", message: `Posted ${res.posted} comment${res.posted !== 1 ? "s" : ""} on #${number}`, link: { href: githubUrl, label: "View" } });
    } catch (err) {
      toast({ kind: "error", message: `Post all failed: ${(err as Error).message}` });
    }
  };

  const position = order.findIndex((p) => p.repo === repo && p.number === number);
  const prevPR = position > 0 ? order[position - 1] : null;
  const nextPR = position >= 0 && position < order.length - 1 ? order[position + 1] : null;

  useHotkeys({
    x: () => {
      const id = focusedAttr("data-finding-id");
      if (id && sortedFindings.some((f) => f.id === id && f.state === "open")) toggleSelected(id);
    },
    p: () => selected.size > 0 && !postFinding.loading && handlePostSelected(),
    Escape: onBack,
  });

  if (prError && !prData) {
    return <NotFound title="Pull request not found" detail={`${repo} #${number}: ${prError}`} backLabel="Back to pull requests" onBack={onBack} />;
  }

  return (
    <main className="flex flex-col gap-4 px-10 pb-10 pt-5">
      <ShellActions>
        {review && <StatusBadge status={review.status} />}
        <LinkButton size="sm" href={githubUrl} target="_blank" rel="noreferrer">
          <Icon name="github" />
          Open on GitHub
          <Icon name="external" />
        </LinkButton>
        {position >= 0 && (
          <Pager
            label={`PR ${position + 1} of ${order.length}`}
            prevLabel="Previous pull request"
            nextLabel="Next pull request"
            onPrev={prevPR ? () => onSelectPR(prevPR.repo, prevPR.number) : undefined}
            onNext={nextPR ? () => onSelectPR(nextPR.repo, nextPR.number) : undefined}
          />
        )}
        <Button size="sm" onClick={onBack} aria-keyshortcuts="Escape" title="Back to pull requests (Esc)">
          <Icon name="arrowLeft" />
          Back to pull requests
        </Button>
      </ShellActions>

      <Card className="overflow-hidden">
        <div className="flex items-start gap-4 px-5 pb-4 pt-[18px]">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {pr ? (
              <h1 className="text-xl font-bold leading-[28px] tracking-[-0.015em]">
                {pr.title} <span className="ml-1 font-mono text-sm font-medium text-fg-3">#{number}</span>
              </h1>
            ) : (
              <Skeleton className="h-5 w-[480px]" />
            )}
            {pr ? (
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-fg-3">
                {pr.author && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={pr.author} />
                      {pr.author}
                    </span>
                    <Dot />
                  </>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="branch" className="size-3.5 text-fg-3" />
                  <Chip mono>{pr.headRefName}</Chip>
                  <Icon name="arrowRight" className="size-3 text-fg-3" />
                  <Chip mono>{pr.baseRefName}</Chip>
                </span>
                <Dot />
                <span className="font-mono">
                  <span className="text-success-ink">+{formatCount(pr.additions)}</span> <span className="text-danger-ink">−{formatCount(pr.deletions)}</span> · {pr.changedFiles} files
                </span>
                {pr.isDraft && (
                  <>
                    <Dot />
                    <Chip>Draft</Chip>
                  </>
                )}
              </div>
            ) : (
              <Skeleton className="h-3 w-80" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 edge-t bg-subtle px-5 py-3">
          <Select id="model" icon="cpu" label="Model" wrapperClassName="w-[168px]" value={model} onChange={(e) => setModel(e.target.value)} disabled={isRunning}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </Select>
          <Select id="effort" icon="gauge" label="Effort" wrapperClassName="w-[248px]" value={effort} onChange={(e) => setEffort(e.target.value)} disabled={isRunning}>
            <option value="quick">Quick · low effort</option>
            <option value="standard">Standard · medium effort</option>
            <option value="thorough">Thorough · high effort</option>
            <option value="exhaustive">Exhaustive · max effort</option>
          </Select>
          <Input
            id="skills"
            icon="star"
            wrapperClassName="w-[260px]"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            placeholder="Skills, comma-separated (optional)"
            disabled={isRunning}
          />
          <Button variant="primary" onClick={handleStartReview} disabled={isRunning || startReview.loading}>
            <Icon name={review?.status === "failed" ? "refresh" : "play"} />
            {isRunning ? "Review running…" : review?.status === "failed" ? "Retry Review" : "Start Review"}
          </Button>
          {review && (
            <span className="font-mono text-xs text-fg-3">
              {review.skills.length > 0 && `${review.skills.join(", ")} · `}
              {relativeTime(review.updatedAt)}
            </span>
          )}
          <div className="flex-1" />
          {review && <SessionButton repo={repo} number={number} status={review.status} onOpen={onOpenSession} />}
          {review && (
            <Button
              variant={showThread ? "plain" : "quiet"}
              aria-pressed={showThread}
              aria-expanded={showThread}
              aria-controls="review-thread"
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
            <div className="flex items-start gap-3.5 px-5 pb-4 pt-3.5">
              <div className="flex flex-1 flex-col gap-1.5">
                <pre className="max-w-[900px] whitespace-pre-wrap edge bg-surface px-2.5 py-2 font-mono text-xs leading-[18px] text-danger-ink">{review.error}</pre>
              </div>
              <div className="flex gap-2">
                <ReimportButton repo={repo} number={number} error={review.error} onDone={refetchReview} />
                <Button size="sm" onClick={() => navigator.clipboard?.writeText(review.error ?? "")}>
                  Copy error
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowThread(true);
                    refetchThread();
                  }}
                >
                  <Icon name="terminal" />
                  Open thread
                </Button>
              </div>
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
        {review && <ScopeNote repo={repo} number={number} status={review.status} onOpen={onOpenSession} />}
      </Card>

      {showThread && (
        <section id="review-thread" className="overflow-hidden edge bg-term-bg lift font-mono text-xs leading-5 text-term-fg">
          <div className="flex h-[38px] items-center gap-2.5 edge-term-b pl-3.5 pr-3 font-sans text-xs text-term-head">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="terminal" className="size-3.5" />
              Review thread
            </span>
            <span className="font-mono text-term-muted">{threadData ? `${threadData.log.length} entries` : "loading…"}</span>
            <span className="ml-3 inline-flex gap-3 text-[11px] text-term-muted">
              <span>
                <span className="text-term-tool">■</span> tool call
              </span>
              <span>
                <span className="text-term-muted">■</span> result
              </span>
              <span>
                <span className="text-term-fg">■</span> assistant
              </span>
            </span>
            <Button variant="quiet" size="sm" className="ml-auto text-term-head hover:bg-term-border hover:text-term-fg" onClick={() => refetchThread()}>
              <Icon name="refresh" />
              Refresh
            </Button>
            <Button variant="quiet" size="sm" iconOnly aria-label="Collapse thread" className="text-term-head hover:bg-term-border hover:text-term-fg" onClick={() => setShowThread(false)}>
              <Icon name="chevronUp" />
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
            <div className="flex-1" />
            <Button size="sm" variant="acid" onClick={handlePostSelected} disabled={selected.size === 0 || postFinding.loading} aria-keyshortcuts="P" title="Post selected (P)">
              Post selected <span className="font-mono">({selected.size})</span>
            </Button>
            <Button size="sm" variant="primary" onClick={handlePostAllOpen} disabled={openCount === 0 || postAll.loading}>
              Post all open <span className="font-mono">({openCount})</span>
            </Button>
          </div>

          <div className="flex flex-col">
            {sortedFindings.map((finding) => {
              const isSelected = selected.has(finding.id);
              return (
                <div
                  key={finding.id}
                  data-finding-id={finding.id}
                  className={`group flex h-13 items-center gap-3 edge-soft-b pl-5 pr-4 last:border-b-0 hover:bg-row-hover has-[:focus-visible]:bg-row-hover has-[:focus-visible]:shadow-[inset_5px_0_0_var(--color-primary)] ${
                    isSelected ? "bg-primary-soft" : ""
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    onChange={() => toggleSelected(finding.id)}
                    disabled={finding.state !== "open"}
                    ariaLabel={`Select finding: ${finding.title}`}
                  />
                  <button
                    type="button"
                    onClick={() => onSelectFinding(finding.id)}
                    className="flex h-full min-w-0 flex-1 items-center gap-3 text-left outline-none"
                  >
                    <SeverityBadge severity={finding.severity} className="w-[84px] justify-center" />
                    <span className="w-[300px] shrink-0 truncate font-mono text-xs text-fg-3" title={finding.file}>
                      {finding.file}:{finding.startLine ?? "?"}
                    </span>
                    <span className={`min-w-0 flex-1 truncate font-medium ${finding.state === "dismissed" ? "text-fg-3" : ""}`}>{finding.title}</span>
                    <FindingStateBadge state={finding.state} />
                    <Icon name="chevronRight" className="size-4 text-fg-3 group-hover:text-fg" />
                  </button>
                </div>
              );
            })}
            {sortedFindings.length === 0 && (
              <div className="flex items-center gap-3 p-5 text-fg-2">
                <Icon name="inbox" className="size-4 text-fg-3" />
                {isRunning ? "Findings will appear here as the review progresses." : review.status === "failed" ? "No findings recorded. Retry the review to populate this list." : "No findings yet."}
              </div>
            )}
          </div>
        </Card>
      )}
    </main>
  );
}

function Dot() {
  return <span className="text-fg-3">·</span>;
}
