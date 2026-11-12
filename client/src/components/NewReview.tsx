import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import { reposChanged, useRepos } from "../hooks/useRepos";
import { fetchJson } from "../lib/api";
import { relativeTime } from "../lib/format";
import { parsePrInput } from "../lib/pr-input";
import { JEV_PRECHECK_DEFAULT, JEV_PRECHECK_KEY, findingsToPost } from "../lib/precheck";
import { LAUNCH_DEFAULTS, LAUNCH_KEY, useStoredState } from "../lib/storage";
import { SEVERITIES, type PasteReviewDto, type RecentReviewDto, type RecentReviewsDto } from "../../../shared/types";
import CancelReviewButton from "./CancelReviewButton";
import SeverityBadge from "./SeverityBadge";
import StatusBadge from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Chip } from "./ui/Card";
import { Input, Select } from "./ui/Field";
import Icon from "./ui/Icon";
import { TableSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

const PAGE = 20;
const POLL_MS = 3000;
/** Jev judges a few seconds after a review reports; past this, a finding still unjudged is taken as never judged. */
const JEV_WAIT_MS = 2 * 60_000;

type Notice =
  | { kind: "error"; text: string }
  | { kind: "not-followed"; repo: string; number: number }
  | { kind: "running" | "unchanged"; repo: string; number: number };

const isRunning = (r: RecentReviewDto) => r.status === "running" || r.status === "queued";

/** The home screen: paste a PR to review it, and act on the latest PR reviews without leaving. */
export default function NewReview({ onSelectPR }: { onSelectPR: (repo: string, number: number) => void }) {
  const [launch, setLaunch] = useStoredState("local", LAUNCH_KEY, LAUNCH_DEFAULTS);
  const [precheck] = useStoredState("local", JEV_PRECHECK_KEY, { value: JEV_PRECHECK_DEFAULT });
  const { data: repos } = useRepos();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const { data, error, refetch } = useQuery<RecentReviewsDto>(
    `/api/reviews/recent?limit=${limit}${highlighted ? `&pin=${encodeURIComponent(highlighted)}` : ""}`,
    [limit, highlighted],
    0
  );
  const paste = useMutation<PasteReviewDto>("/api/reviews/paste", "POST");
  const start = useMutation<{ id: string }>("/api/reviews", "POST");
  const { toast } = useToast();

  const reviews = data?.reviews ?? [];
  const jevEnabled = data?.jevEnabled ?? false;
  const live = reviews.some(
    (r) =>
      isRunning(r) ||
      (jevEnabled && r.status === "reported" && r.openFindings.some((f) => f.jevHolds === null) && Date.now() - new Date(r.updatedAt).getTime() < JEV_WAIT_MS)
  );
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refetch, POLL_MS);
    return () => clearInterval(timer);
  }, [live, refetch]);

  const submit = async (repo: string, number: number, follow = false) => {
    try {
      const res = await paste.mutate({ repo, number, model: launch.model, effort: launch.effort, follow });
      if (follow) reposChanged();
      setText("");
      setHighlighted(res.started ? null : res.id);
      setNotice(res.started || !res.reason ? null : { kind: res.reason, repo, number });
      refetch();
    } catch (err) {
      // A follow may have been saved before the failure was known.
      if (follow) reposChanged();
      if ((err as { code?: string }).code === "not-followed") setNotice({ kind: "not-followed", repo, number });
      else setNotice({ kind: "error", text: (err as Error).message });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || paste.loading) return;
    const parsed = parsePrInput(text, repos ?? []);
    if ("error" in parsed) {
      setNotice({ kind: "error", text: parsed.error });
      return;
    }
    void submit(parsed.repo, parsed.number);
  };

  const rerun = async (repo: string, number: number) => {
    try {
      await start.mutate({ repo, number, model: launch.model, effort: launch.effort });
      setNotice(null);
      setHighlighted(null);
      refetch();
    } catch (err) {
      toast({ kind: "error", message: `Could not start review: ${(err as Error).message}` });
    }
  };

  return (
    <main className="flex flex-col gap-5 px-10 pb-10 pt-7">
      <h1 className="font-display text-[length:calc(30px*var(--font-scale))] uppercase leading-none">New review</h1>

      <Card>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 px-5 py-4">
          <Input
            id="new-pr"
            icon="pullRequest"
            wrapperClassName="min-w-[calc(320px*var(--font-scale))] flex-1"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setNotice(null);
            }}
            placeholder="Paste a pull request address, or type repo#123, then press Enter"
            aria-label="Pull request"
            aria-describedby={notice ? "new-pr-notice" : undefined}
            error={notice?.kind === "error" || notice?.kind === "not-followed"}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <Select id="new-model" icon="cpu" label="Model" wrapperClassName="w-[calc(168px*var(--font-scale))] shrink-0" value={launch.model} onChange={(e) => setLaunch((l) => ({ ...l, model: e.target.value }))}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </Select>
          <Select id="new-effort" icon="gauge" label="Effort" wrapperClassName="w-[calc(248px*var(--font-scale))] shrink-0" value={launch.effort} onChange={(e) => setLaunch((l) => ({ ...l, effort: e.target.value }))}>
            <option value="quick">Quick · low effort</option>
            <option value="standard">Standard · medium effort</option>
            <option value="thorough">Thorough · high effort</option>
            <option value="exhaustive">Exhaustive · max effort</option>
          </Select>
          <Button type="submit" variant="primary" disabled={!text.trim() || paste.loading}>
            <Icon name="play" />
            {paste.loading ? "Starting…" : "Review"}
          </Button>
        </form>
        {notice && (
          <div id="new-pr-notice" role={notice.kind === "error" || notice.kind === "not-followed" ? "alert" : "status"} className="flex flex-wrap items-center gap-3 edge-t bg-subtle px-5 py-3 text-xs text-fg-2">
            <Icon name="alert" className="size-3.5 shrink-0 text-fg" />
            {notice.kind === "error" && <span>{notice.text}</span>}
            {notice.kind === "not-followed" && (
              <>
                <span>
                  <span className="font-mono">{notice.repo}</span> is not a followed repository, so nothing was started.
                </span>
                <Button size="sm" variant="acid" disabled={paste.loading} onClick={() => void submit(notice.repo, notice.number, true)}>
                  Follow this repository and review
                </Button>
              </>
            )}
            {notice.kind === "unchanged" && (
              <>
                <span>
                  <span className="font-mono">{`${notice.repo}#${notice.number}`}</span> has no new commit since its last review, so nothing was started.
                </span>
                <Button size="sm" disabled={start.loading} onClick={() => void rerun(notice.repo, notice.number)}>
                  <Icon name="refresh" />
                  Re-run
                </Button>
              </>
            )}
            {notice.kind === "running" && (
              <span>
                <span className="font-mono">{`${notice.repo}#${notice.number}`}</span> is already being reviewed.
              </span>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-[length:calc(22px*var(--font-scale))] uppercase leading-none">Latest reviews</h2>
        {data && <span className="font-mono text-xs text-fg-3">pull requests only</span>}
      </div>

      {!data && error ? (
        <Card className="flex items-center gap-3 px-5 py-4 text-xs">
          <Icon name="alert" className="size-3.5 text-danger-ink" />
          <span>Could not load the reviews: {error}</span>
          <Button size="sm" onClick={refetch}>
            <Icon name="refresh" />
            Retry
          </Button>
        </Card>
      ) : !data ? (
        <Card className="overflow-hidden">
          <TableSkeleton rows={4} cols={4} />
        </Card>
      ) : reviews.length === 0 ? (
        <Card className="flex min-h-[160px] flex-col items-center justify-center gap-2 p-10 text-center">
          <Icon name="inbox" className="size-6 text-fg-3" />
          <p className="text-fg-2">No pull request reviewed yet. Paste one above to start.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                highlighted={review.id === highlighted}
                jevEnabled={jevEnabled}
                threshold={precheck.value}
                onOpen={() => onSelectPR(review.repo, review.number)}
                onRerun={() => void rerun(review.repo, review.number)}
                onChanged={refetch}
              />
            </li>
          ))}
        </ul>
      )}

      {data?.hasMore && (
        <Button className="self-center" onClick={() => setLimit((n) => n + PAGE)}>
          Show more
        </Button>
      )}
    </main>
  );
}

function ReviewCard({
  review,
  highlighted,
  jevEnabled,
  threshold,
  onOpen,
  onRerun,
  onChanged,
}: {
  review: RecentReviewDto;
  highlighted: boolean;
  jevEnabled: boolean;
  threshold: number;
  onOpen: () => void;
  onRerun: () => void;
  onChanged: () => void;
}) {
  const { repo, number } = review;
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const toPost = findingsToPost(review.openFindings, jevEnabled, threshold);
  const stopped = review.status === "failed" || review.status === "cancelled";
  const reported = review.status === "reported";

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast({ kind: "error", message: `${failure}: ${(err as Error).message}` });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const post = () =>
    act(async () => {
      const n = toPost.length;
      if (!window.confirm(`Post ${n} comment${n !== 1 ? "s" : ""} on #${number}?`)) return;
      const res = await fetchJson<{ posted: number }>(`/api/reviews/${repo}/${number}/post-all`, { method: "POST", body: JSON.stringify({ ids: toPost }) });
      toast({ kind: "success", message: `Posted ${res.posted} comment${res.posted !== 1 ? "s" : ""} on #${number}`, link: { href: `https://github.com/${repo}/pull/${number}`, label: "View" } });
    }, "Post failed");

  const approve = () =>
    act(async () => {
      const { warnings } = await fetchJson<{ warnings: string[] }>(`/api/reviews/${repo}/${number}/approval-check`);
      if (!window.confirm([`Approve #${number}?`, ...(warnings.length > 0 ? ["", ...warnings.map((w) => `• ${w}`)] : [])].join("\n"))) return;
      const res = await fetchJson<{ url: string }>(`/api/reviews/${repo}/${number}/submit`, { method: "POST", body: JSON.stringify({ event: "APPROVE", body: "" }) });
      toast({ kind: "success", message: `Approved #${number}`, link: { href: res.url, label: "View" } });
    }, "Could not approve");

  // The whole card opens the PR; its buttons act in place.
  const inPlace = (e: MouseEvent) => e.stopPropagation();

  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      onClick={onOpen}
      className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-row-hover ${highlighted ? "outline-3 outline-offset-2 outline-primary" : ""}`}
    >
      <div className="flex min-w-[calc(240px*var(--font-scale))] flex-1 flex-col gap-1">
        <button type="button" onClick={onOpen} className="truncate text-left font-medium text-fg focus-ring">
          {review.title || "Untitled pull request"}
        </button>
        <span className="font-mono text-xs text-fg-3">
          {`${repo}#${number}`} · {relativeTime(review.updatedAt)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITIES.filter((s) => review.severities[s]).map((s) => (
          <SeverityBadge key={s} severity={s} count={review.severities[s]} labelled />
        ))}
        <StatusBadge status={review.status} />
        {review.approved && <StatusBadge status="reported" label="Approved" />}
        {review.postedFindings > 0 && <Chip mono>{review.postedFindings} posted</Chip>}
      </div>

      <div className="flex shrink-0 items-center gap-2" onClick={inPlace}>
        {isRunning(review) && <CancelReviewButton repo={repo} number={number} onDone={onChanged} size="sm" label="Cancel" />}
        {stopped && (
          <Button size="sm" disabled={busy} onClick={onRerun}>
            <Icon name="refresh" />
            Retry
          </Button>
        )}
        {reported && highlighted && (
          <Button size="sm" disabled={busy} onClick={onRerun}>
            <Icon name="refresh" />
            Re-run
          </Button>
        )}
        {reported && !review.approved && (
          <>
            <Button size="sm" disabled={busy} onClick={approve}>
              <Icon name="check" />
              Approve
            </Button>
            <Button size="sm" variant="primary" disabled={busy || toPost.length === 0} onClick={post}>
              <Icon name="send" />
              {toPost.length === 0 ? "Nothing to post" : `Post ${toPost.length}`}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
