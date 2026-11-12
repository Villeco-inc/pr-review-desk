import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import NotFound from "./ui/NotFound";
import type { FindingDto, ReviewDto } from "../../../shared/types";
import SeverityBadge from "./SeverityBadge";
import { FindingStateBadge } from "./StatusBadge";
import DiffViewer from "./DiffViewer";
import Button from "./ui/Button";
import Card, { Band, Chip } from "./ui/Card";
import { Segmented, Textarea } from "./ui/Field";
import Icon from "./ui/Icon";
import Skeleton, { CardSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { ShellActions } from "./AppShell";
import Pager from "./ui/Pager";
import { useHotkeys } from "../hooks/useHotkeys";

interface ReviewWithFindings extends ReviewDto {
  findings: FindingDto[];
}

const SEVERITY_ORDER: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3, nit: 4 };

type BandTone = "info" | "problem" | "summary";

function Section({ title, body, tone, last = false }: { title: string; body: string; tone: BandTone; last?: boolean }) {
  return (
    <div className={`flex flex-col ${last ? "" : "edge-b"}`}>
      <Band tone={tone}>{title}</Band>
      <p className="whitespace-pre-wrap px-5 py-3.5 text-fg-2">{body}</p>
    </div>
  );
}

export default function FindingDetail({
  findingId,
  repo,
  number,
  onBack,
  onSelectFinding,
  readOnly = false,
}: {
  findingId: string;
  repo: string;
  number: number;
  onBack: () => void;
  onSelectFinding?: (id: string) => void;
  readOnly?: boolean;
}) {
  const { data: review, error: reviewError, refetch: refetchReview } = useQuery<ReviewWithFindings>(`/api/reviews/${repo}/${number}`);
  const { toast } = useToast();

  const sorted = useMemo(
    () => [...(review?.findings ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [review]
  );
  const index = sorted.findIndex((f) => f.id === findingId);
  const finding = index >= 0 ? sorted[index] : null;
  const prev = index > 0 ? sorted[index - 1] : null;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

  const { data: diffData, error: diffError, loading: diffLoading } = useQuery<{ patch: string }>(
    finding ? `/api/reviews/${repo}/${number}/diff/${finding.file}` : null,
    [finding?.file]
  );

  const [comment, setComment] = useState("");
  const [mode, setMode] = useState<"inline" | "issue">("inline");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (finding) {
      setComment(finding.draftComment ?? finding.suggestedComment);
      setSaveState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding?.id]);

  const saveComment = useMutation<FindingDto>(`/api/findings/${findingId}/comment`, "PATCH");
  const postFinding = useMutation<{ url: string }>(`/api/findings/${findingId}/post`, "POST");
  const dismissFinding = useMutation<FindingDto>(`/api/findings/${findingId}/dismiss`, "PATCH");
  const reopenFinding = useMutation<FindingDto>(`/api/findings/${findingId}/reopen`, "PATCH");

  const goPrev = prev && onSelectFinding ? () => onSelectFinding(prev.id) : undefined;
  const goNext = next && onSelectFinding ? () => onSelectFinding(next.id) : undefined;
  useHotkeys({ j: goNext, k: goPrev, Escape: onBack });

  if (!finding && (review || reviewError)) {
    return <NotFound title="Finding not found" detail={reviewError ?? "It is not part of this review any more."} backLabel="All findings" onBack={onBack} />;
  }

  if (!finding) {
    return (
      <main className="flex flex-col gap-4 px-10 pb-10 pt-5">
        <ShellActions>
          <Button size="sm" onClick={onBack} aria-keyshortcuts="Escape" title="All findings (Esc)">
            <Icon name="arrowLeft" />
            All findings
          </Button>
        </ShellActions>
        <Card className="flex flex-col gap-2.5 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-[560px]" />
          <Skeleton className="h-3 w-72" />
        </Card>
        {readOnly ? (
          <CardSkeleton lines={3} />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_400px] gap-4">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={5} />
          </div>
        )}
        <CardSkeleton lines={6} />
      </main>
    );
  }

  const isPosted = finding.state === "posted";
  // A finding a later run found fixed reopens the same way a dismissed one does.
  const isDismissed = finding.state === "dismissed" || finding.state === "resolved";

  const handleBlurSave = async () => {
    if (comment === (finding.draftComment ?? finding.suggestedComment)) return;
    setSaveState("saving");
    try {
      await saveComment.mutate({ draftComment: comment });
      setSaveState("saved");
      refetchReview();
    } catch (err) {
      setSaveState("idle");
      toast({ kind: "error", message: `Draft not saved: ${(err as Error).message}` });
    }
  };

  const handlePost = async () => {
    try {
      if (comment !== (finding.draftComment ?? finding.suggestedComment)) {
        await saveComment.mutate({ draftComment: comment });
      }
      const res = await postFinding.mutate({ mode });
      refetchReview();
      toast({ kind: "success", message: <>Comment posted on <span className="font-mono">#{number}</span></>, link: { href: res.url, label: "View" } });
    } catch (err) {
      toast({ kind: "error", message: `Post failed: ${(err as Error).message}` });
    }
  };

  const handleDismissToggle = async () => {
    try {
      if (isDismissed) await reopenFinding.mutate();
      else await dismissFinding.mutate();
      refetchReview();
    } catch (err) {
      toast({ kind: "error", message: `${isDismissed ? "Reopen" : "Dismiss"} failed: ${(err as Error).message}` });
    }
  };

  const handleReset = () => {
    setComment(finding.suggestedComment);
    setSaveState("idle");
  };

  const lineRange = finding.startLine != null ? `${finding.startLine}${finding.endLine && finding.endLine !== finding.startLine ? `–${finding.endLine}` : ""}` : null;
  const githubUrl =
    !readOnly && finding.startLine != null
      ? `https://github.com/${review?.repo ?? repo}/blob/HEAD/${finding.file}#L${finding.startLine}${finding.endLine ? `-L${finding.endLine}` : ""}`
      : null;

  const FOLLOWUP_TITLE: Record<string, string> = { resolved: "Fixed by later commits", still_present: "Still there after later commits", unclear: "Later commits: unclear" };
  const evidenceLeft = [
    finding.followupStatus && {
      title: FOLLOWUP_TITLE[finding.followupStatus],
      body: finding.followupNote || "No note from the second pass.",
      tone: finding.followupStatus === "resolved" ? ("summary" as const) : ("info" as const),
    },
    finding.background && { title: "Background", body: finding.background, tone: "info" as const },
    finding.problem && { title: "Problem", body: finding.problem, tone: "problem" as const },
  ].filter(Boolean) as { title: string; body: string; tone: "info" | "problem" | "summary" }[];
  const hasEvidence = evidenceLeft.length > 0 || !!finding.suggestedFix;

  const evidence = hasEvidence && (
    <Card className={`grid ${evidenceLeft.length > 0 && finding.suggestedFix ? "grid-cols-2" : "grid-cols-1"}`}>
      {evidenceLeft.length > 0 && (
        <div className="flex min-w-0 flex-col">
          {evidenceLeft.map((e, i) => (
            <Section key={e.title} title={e.title} body={e.body} tone={e.tone} last={i === evidenceLeft.length - 1} />
          ))}
        </div>
      )}
      {finding.suggestedFix && (
        <div className={`flex min-w-0 flex-col ${evidenceLeft.length > 0 ? "edge-l" : ""}`}>
          <Section title="Suggested fix" body={finding.suggestedFix} tone="summary" last />
        </div>
      )}
    </Card>
  );

  const references = finding.references.length > 0 && (
    <Card className="flex flex-col">
      <div className="flex h-11 items-center gap-2 edge-b px-4">
        <span className="label-caps">References</span>
        <span className="font-mono text-xs text-fg-3">{finding.references.length}</span>
      </div>
      <ul className="flex flex-col">
        {finding.references.map((ref, idx) => {
          const range = ref.startLine ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `–${ref.endLine}` : ""}` : "";
          const href = readOnly
            ? null
            : `https://github.com/${review?.repo ?? repo}/blob/HEAD/${ref.file}${ref.startLine ? `#L${ref.startLine}${ref.endLine ? `-L${ref.endLine}` : ""}` : ""}`;
          const content = (
            <>
              <span className="break-all font-mono text-xs text-fg-2">
                {ref.file}
                {range && <span className="text-fg-3">{range}</span>}
              </span>
              {ref.note && <span className="text-xs text-fg-3">{ref.note}</span>}
            </>
          );
          return (
            <li key={idx} className="edge-soft-b last:border-b-0">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 px-4 py-2.5 text-fg hover:bg-row-hover hover:no-underline focus-ring">
                  {content}
                </a>
              ) : (
                <div className="flex flex-col gap-0.5 px-4 py-2.5 text-fg">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );

  return (
    <main className="flex flex-col gap-4 px-10 pb-10 pt-5">
      <ShellActions>
        {onSelectFinding && (
          <Pager
            label={`Finding ${index + 1} of ${sorted.length}`}
            prevLabel="Previous finding"
            nextLabel="Next finding"
            prevKey="K"
            nextKey="J"
            onPrev={goPrev}
            onNext={goNext}
          />
        )}
        <Button size="sm" onClick={onBack} aria-keyshortcuts="Escape" title="All findings (Esc)">
          <Icon name="arrowLeft" />
          All findings
        </Button>
      </ShellActions>

      <Card className="flex items-start gap-4 px-5 py-[18px]">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            {finding.category && <Chip>{finding.category}</Chip>}
            <FindingStateBadge state={finding.state} />
          </div>
          <h1 className="text-xl font-bold leading-[calc(28px*var(--font-scale))] tracking-[-0.015em]">{finding.title}</h1>
          {githubUrl ? (
            <a href={githubUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 font-mono text-xs text-fg-2 hover:bg-acid hover:text-acid-fg focus-ring">
              <Icon name="file" className="size-3.5 text-fg-3" />
              {finding.file}
              {lineRange && <span className="text-fg-3">:{lineRange}</span>}
              <Icon name="external" className="size-3.5 text-fg-3" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-2">
              <Icon name="file" className="size-3.5 text-fg-3" />
              {finding.file}
              {lineRange && <span className="text-fg-3">:{lineRange}</span>}
            </span>
          )}
        </div>
        {/* Read-only (local) findings have nowhere to post, so there is nothing to act on here. */}
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant={isDismissed ? "plain" : "danger"} onClick={handleDismissToggle} disabled={isPosted || dismissFinding.loading || reopenFinding.loading}>
              {isDismissed ? "Reopen" : "Dismiss"}
            </Button>
            <Button variant="primary" onClick={handlePost} disabled={isPosted || finding.state === "resolved" || postFinding.loading}>
              <Icon name="send" />
              {isPosted ? "Posted" : "Post comment"}
            </Button>
          </div>
        )}
      </Card>

      {readOnly ? (
        <>
          {evidence}
          {references}
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">{evidence}</div>

          <aside className="flex flex-col gap-4">
            <Card className="flex flex-col">
              <div className="flex h-11 items-center gap-2 edge-b pl-4 pr-3">
                <span className="label-caps">Comment</span>
                <span className="font-mono text-[length:calc(11px*var(--font-scale))] text-fg-3">
                  {saveState === "saving" ? "saving…" : saveState === "saved" ? "draft saved" : finding.draftComment ? "edited" : "suggested"}
                </span>
                <div className="ml-auto">
                  <Segmented
                    ariaLabel="Post mode"
                    value={mode}
                    onChange={setMode}
                    disabled={isPosted}
                    options={[
                      { value: "inline", label: "Inline" },
                      { value: "issue", label: "Issue" },
                    ]}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-3">
                <label htmlFor="comment" className="sr-only">
                  Comment body
                </label>
                <Textarea id="comment" rows={9} value={comment} onChange={(e) => setComment(e.target.value)} onBlur={handleBlurSave} disabled={isPosted} />
                <p className="text-xs text-fg-3">
                  {mode === "inline" ? (
                    <>
                      Posts as an inline review comment on <span className="font-mono">{finding.file.split("/").pop()}{lineRange ? `:${lineRange}` : ""}</span> ({finding.side} side).
                    </>
                  ) : (
                    "Posts as a general comment on the pull request."
                  )}
                </p>
                {!isPosted && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button variant="quiet" onClick={handleReset} disabled={comment === finding.suggestedComment}>
                      Reset to suggested
                    </Button>
                    <Button variant="primary" className="ml-auto" onClick={handlePost} disabled={postFinding.loading || !comment.trim()}>
                      <Icon name="send" />
                      Post comment
                    </Button>
                  </div>
                )}
              </div>
              {isPosted && (
                <div className="flex flex-col gap-1 edge-t bg-success-soft px-4 py-3 text-success-ink">
                  <div className="flex items-center gap-2">
                    <Icon name="checkCircle" className="size-4" />
                    <span className="font-medium">Posted as {finding.postedAs === "pending-review" ? "pending review comment" : "comment"}</span>
                    {finding.commentUrl && (
                      <a href={finding.commentUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-success-ink hover:bg-acid hover:text-acid-fg focus-ring">
                        View on GitHub
                        <Icon name="external" className="size-3.5" />
                      </a>
                    )}
                  </div>
                  {finding.postedAt && <span className="font-mono text-xs">{new Date(finding.postedAt).toLocaleString()}</span>}
                </div>
              )}
            </Card>

            {references}
          </aside>
        </div>
      )}

      {/* Full width: at sidebar width every line over ~80 chars was clipped. */}
      {diffData?.patch ? (
        <DiffViewer patch={diffData.patch} file={finding.file} highlightStart={finding.startLine} highlightEnd={finding.endLine} side={finding.side} />
      ) : diffError && !diffLoading ? (
        <Card className="overflow-hidden">
          <div className="flex h-[38px] items-center gap-1.5 edge-b bg-subtle px-3.5 font-mono text-xs text-fg-2">
            <Icon name="file" className="size-3.5 text-fg-3" />
            {finding.file}
          </div>
          <div className="flex items-center gap-3 p-4 text-fg-2">
            <Icon name="inbox" className="size-4 text-fg-3" />
            <span>
              This file is not part of the pull request diff, so there is nothing to show here.
              {githubUrl && (
                <>
                  {" "}
                  <a href={githubUrl} target="_blank" rel="noreferrer" className="font-bold underline hover:bg-acid hover:text-acid-fg focus-ring">
                    Open it on GitHub
                  </a>
                  .
                </>
              )}
            </span>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex h-[38px] items-center gap-3 edge-b bg-subtle px-3.5">
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex flex-col gap-2 p-3.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={`h-3 ${["w-1/2", "w-3/4", "w-2/3", "w-1/3", "w-5/6", "w-1/2", "w-2/5", "w-3/5"][i]}`} />
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
