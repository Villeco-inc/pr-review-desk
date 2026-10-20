import { useEffect, useMemo, useState } from "react";
import { invalidateCache, useMutation, useQuery } from "../hooks/useApi";
import { useRepos } from "../hooks/useRepos";
import { ALL_REPOS } from "../../../shared/types";
import type { Freshness, PullRequestDto, ReviewDto } from "../../../shared/types";
import StatusBadge, { MyReviewBadge } from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Chip } from "./ui/Card";
import { Select } from "./ui/Field";
import MultiSelect from "./ui/MultiSelect";
import Icon from "./ui/Icon";
import Avatar from "./ui/Avatar";
import { TableSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { formatCount, relativeTime } from "../lib/format";
import { ShellActions, useRailCount } from "./AppShell";
import { focusedAttr, moveFocus, useHotkeys } from "../hooks/useHotkeys";
import { describePrListError } from "../lib/github-errors";
import { describeFreshness } from "../lib/freshness";
import { isListLoading, shownError } from "../lib/list-state";
import { useNow } from "../hooks/useNow";
import { savePrOrder, type PrListSearch, type SortKey, type SortDir } from "../lib/url-state";

const TH = "h-10 whitespace-nowrap bg-subtle px-3 text-left label-caps text-fg-2 edge-b first:pl-4";
// Row dividers are the one hairline allowed: they sit inside a bordered block.
const TD = "h-[var(--row-h)] whitespace-nowrap px-3 align-middle edge-soft-b group-last:border-b-0 first:pl-4";
// The row is the click target; the title is the real control, so its name is the accessible name.
// Hover fills the cells (acid in brutalism) with no transition; keyboard focus draws a blue bar on the first cell.
const ROW =
  "group cursor-pointer hover:[&>td]:bg-row-hover has-[:focus-visible]:[&>td]:bg-row-hover has-[:focus-visible]:[&>td:first-child]:shadow-[inset_5px_0_0_var(--color-primary)]";
const ROW_TITLE = "min-w-0 max-w-full truncate text-left font-medium outline-none";

type PrStatus = "draft" | "approved" | "changes_requested" | "review_required";

const STATUS_LABELS: Record<PrStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

function statusOf(pr: PullRequestDto): PrStatus {
  if (pr.isDraft) return "draft";
  if (pr.reviewDecision === "APPROVED") return "approved";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes_requested";
  return "review_required";
}

const REVIEW_RANK: Record<PullRequestDto["reviewStatus"], number> = {
  none: 0,
  queued: 1,
  running: 2,
  failed: 3,
  reported: 4,
};

const canStartReview = (pr: PullRequestDto) =>
  pr.reviewStatus === "none" || pr.reviewStatus === "reported" || pr.reviewStatus === "failed";

// The server keeps its cache fresh while the app is open; the page only asks how fresh it is, this often.
const FRESHNESS_CHECK_MS = 10_000;

const allReposLabel = (count: number) => `All selected repos (${count})`;

export default function PRList({
  search,
  onSearchChange,
  onRepoChange,
  onSelectPR,
}: {
  /** Filters and sort come from the URL; every change goes back through onSearchChange. */
  search: PrListSearch;
  onSearchChange: (next: PrListSearch) => void;
  /** Switching repo restores that repo's own remembered filters. */
  onRepoChange: (repo: string) => void;
  onSelectPR: (repo: string, number: number) => void;
}) {
  const { data: repos, error: reposError, refetch: refetchRepos } = useRepos();
  const { data: viewer } = useQuery<{ login: string }>("/api/viewer", [], 5 * 60_000);
  const [refreshKey, setRefreshKey] = useState(0);
  const authors = useMemo(() => new Set(search.author ?? []), [search.author]);
  const statuses = useMemo(() => new Set(search.status ?? []), [search.status]);
  const labels = useMemo(() => new Set(search.label ?? []), [search.label]);
  const sortKey: SortKey = search.sort ?? "number";
  const sortDir: SortDir = search.dir ?? "desc";
  const setFilter = (key: "author" | "status" | "label") => (next: Set<string>) => onSearchChange({ ...search, [key]: [...next] });
  const [startingReview, setStartingReview] = useState<string | null>(null);
  const { toast } = useToast();
  const startReviewMutation = useMutation<ReviewDto>("/api/reviews", "POST");

  const handleStartReview = async (pr: PullRequestDto) => {
    const key = `${pr.repo}#${pr.number}`;
    if (startingReview === key) return;
    setStartingReview(key);
    try {
      await startReviewMutation.mutate({ repo: pr.repo, number: pr.number });
      toast({ kind: "success", message: `Review started for #${pr.number}` });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ kind: "error", message: `Failed to start review: ${(err as Error).message}` });
    } finally {
      setStartingReview(null);
    }
  };

  const knownRepo = (r: string | undefined) => !!r && (r === ALL_REPOS || (repos ?? []).includes(r));
  // Nothing is asked for until the selection is known: a remembered repository may no longer be one.
  const repo = repos ? (knownRepo(search.repo) ? search.repo! : repos[0] ?? "") : "";
  const isAllView = repo === ALL_REPOS;

  // Write the effective repo into the URL once the repo list is known. A remembered repo that is
  // no longer configured is dropped silently, and its replacement brings its own filters.
  useEffect(() => {
    if (!repos || !repo || search.repo === repo) return;
    if (search.repo === undefined) onSearchChange({ ...search, repo });
    else onRepoChange(repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, repo, search.repo]);

  // The cheap question comes first: the list is loaded once its answer is in, and again whenever the
  // server fetched something new.
  const freshnessKey = repo ? `/api/freshness?repo=${encodeURIComponent(repo)}` : null;
  const {
    data: freshnessData,
    dataKey: freshnessDataKey,
    error: freshnessError,
  } = useQuery<Freshness>(freshnessKey, [repo, refreshKey], 0, FRESHNESS_CHECK_MS);
  const freshness = freshnessData && freshnessDataKey === freshnessKey ? freshnessData : null;
  const now = useNow(FRESHNESS_CHECK_MS);

  const prsKey = repo ? `/api/prs?repo=${encodeURIComponent(repo)}` : null;
  const { data: prs, dataKey, loading: listLoading, error: listError } = useQuery<PullRequestDto[]>(
    freshness ? prsKey : null,
    [repo, refreshKey, freshness?.version],
    0
  );
  const error = shownError({ hasRepos: !!repos, reposError, listError, freshnessError, hasFreshness: !!freshness });
  // Right after a repo switch the previous repo's rows are still in hand for a frame.
  const rowsAreCurrent = !!prs && dataKey === prsKey;
  const loading = isListLoading({ repo, rowsAreCurrent, listLoading, failed: !!error, waitingForRepos: !repos && !reposError });
  const prsAreCurrent = rowsAreCurrent && !loading;
  // The age speaks for the rows on screen: it waits while they reload and while a reload failed.
  const freshnessText = freshness ? describeFreshness(freshness, now) : null;
  const freshnessStale = loading || !!listError;
  useRailCount("prs", prs?.length);

  const authorOptions = useMemo(
    () => [...new Set((prs ?? []).map((p) => p.author))].sort().map((a) => ({ value: a, label: a })),
    [prs]
  );
  const labelOptions = useMemo(
    () => [...new Set((prs ?? []).flatMap((p) => p.labels))].sort().map((l) => ({ value: l, label: l })),
    [prs]
  );
  const statusOptions = (Object.keys(STATUS_LABELS) as PrStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }));

  // A remembered author or label with no open pull request left would empty the list for no
  // visible reason: drop it, keep the rest of the selection.
  useEffect(() => {
    if (!prsAreCurrent) return;
    const keep = (selected: string[] | undefined, options: { value: string }[]) =>
      selected?.filter((v) => options.some((o) => o.value === v));
    const author = keep(search.author, authorOptions);
    const label = keep(search.label, labelOptions);
    if (author?.length !== search.author?.length || label?.length !== search.label?.length) {
      onSearchChange({ ...search, author, label });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prsAreCurrent, authorOptions, labelOptions]);

  const filtered = (prs ?? []).filter((p) => {
    if (authors.size > 0 && !authors.has(p.author)) return false;
    if (statuses.size > 0 && !statuses.has(statusOf(p))) return false;
    if (labels.size > 0 && !p.labels.some((l) => labels.has(l))) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const diff =
      sortKey === "number"
        ? a.number - b.number
        : sortKey === "updated"
          ? new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          : REVIEW_RANK[a.reviewStatus] - REVIEW_RANK[b.reviewStatus];
    return sortDir === "asc" ? diff : -diff;
  });
  const running = sorted.filter((p) => p.reviewStatus === "running").length;
  const open = (pr: PullRequestDto) => {
    // The pager walks exactly the list the user was looking at, so its order is taken now.
    savePrOrder(sorted.map((p) => ({ repo: p.repo, number: p.number })));
    onSelectPR(pr.repo, pr.number);
  };

  useHotkeys({
    j: () => moveFocus("[data-row-nav]", 1),
    k: () => moveFocus("[data-row-nav]", -1),
    r: () => {
      const key = focusedAttr("data-pr");
      const pr = sorted.find((p) => `${p.repo}#${p.number}` === key);
      if (pr && canStartReview(pr)) handleStartReview(pr);
    },
  });

  const toggleSort = (key: SortKey) => {
    onSearchChange({ ...search, sort: key, dir: sortKey === key && sortDir === "desc" ? "asc" : "desc" });
  };

  // Asks GitHub now, then rereads the list. The cache a failed ask leaves behind still shows, dated by freshness.
  const forceRefresh = useMutation<Freshness>("/api/refresh", "POST");
  const refresh = async () => {
    try {
      await forceRefresh.mutate(undefined, `/api/refresh?repo=${encodeURIComponent(repo)}`);
    } catch (err) {
      toast({ kind: "error", message: describePrListError((err as Error).message) });
    }
    invalidateCache("/api/prs");
    invalidateCache("/api/freshness");
    setRefreshKey((k) => k + 1);
  };
  const refreshing = loading || forceRefresh.loading;

  return (
    <main className="flex flex-col gap-5 px-10 pb-10 pt-7">
      <ShellActions>
        {freshnessText && (
          <span
            className={`font-mono text-xs ${freshness?.error ? "text-danger-ink" : "text-fg-3"} ${freshnessStale ? "invisible" : ""}`}
            title={freshness?.error ?? undefined}
          >
            {freshnessText}
          </span>
        )}
        <Button size="sm" onClick={refresh} disabled={refreshing}>
          <Icon name="refresh" className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </ShellActions>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[34px] uppercase leading-none tracking-[0.01em]">Pull requests</h1>
          <span className="font-mono text-xs text-fg-3">
            {loading
              ? "Refreshing…"
              : `${sorted.length} open${sorted.length !== (prs?.length ?? 0) ? ` of ${prs?.length ?? 0}` : ""}${running ? ` · ${running} running` : ""}`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <MultiSelect label="Author" options={authorOptions} selected={authors} onChange={setFilter("author")} wrapperClassName="w-40" />
          <MultiSelect label="Status" options={statusOptions} selected={statuses} onChange={setFilter("status")} wrapperClassName="w-44" />
          <MultiSelect label="Label" options={labelOptions} selected={labels} onChange={setFilter("label")} wrapperClassName="w-40" />
          <Select
            id="repo"
            icon="repo"
            wrapperClassName="w-60"
            value={repo}
            onChange={(e) => onRepoChange(e.target.value)}
            aria-label="Repository"
          >
            {(repos?.length ?? 0) > 0 && <option value={ALL_REPOS}>{allReposLabel(repos!.length)}</option>}
            {(repos ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 edge bg-danger-soft px-3.5 py-2.5 text-fg lift">
          <Icon name="alert" className="size-4 text-danger-ink" />
          <span className="font-medium">Could not load pull requests</span>
          <span className="font-mono text-xs text-danger-ink">
            {describePrListError(error)}
          </span>
          <Button size="sm" className="ml-auto" onClick={repos ? refresh : refetchRepos}>
            <Icon name="refresh" />
            Retry
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading && !prs ? (
          <TableSkeleton rows={6} cols={5} />
        ) : sorted.length === 0 && !loading ? (
          <EmptyState
            repo={isAllView ? allReposLabel(repos?.length ?? 0) : repo}
            filtered={(prs?.length ?? 0) > 0}
            onRefresh={refresh}
          />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <SortableTh label="#" width="70px" active={sortKey === "number"} dir={sortDir} onClick={() => toggleSort("number")} />
                <th className={TH}>Title</th>
                {isAllView && <th className={`${TH} w-[160px]`}>Repo</th>}
                <th className={`${TH} w-[150px]`}>Author</th>
                <th className={`${TH} w-[120px]`}>My review</th>
                <th className={`${TH} w-[110px]`}>+ / −</th>
                <SortableTh label="Updated" width="110px" active={sortKey === "updated"} dir={sortDir} onClick={() => toggleSort("updated")} />
                <SortableTh label="Review" width="140px" active={sortKey === "review"} dir={sortDir} onClick={() => toggleSort("review")} />
                <th className={`${TH} w-[170px]`}>Findings</th>
                <th className={`${TH} w-[88px]`} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((pr) => (
                <tr
                  key={`${pr.repo}#${pr.number}`}
                  data-pr={`${pr.repo}#${pr.number}`}
                  onClick={() => open(pr)}
                  className={ROW}
                >
                  <td className={`${TD} font-mono text-fg-3`}>#{pr.number}</td>
                  <td className={`${TD} max-w-0`}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        data-row-nav
                        className={ROW_TITLE}
                        onClick={(e) => {
                          e.stopPropagation();
                          open(pr);
                        }}
                      >
                        {pr.title}
                      </button>
                      {pr.isDraft && <Chip className="shrink-0">Draft</Chip>}
                    </span>
                  </td>
                  {isAllView && (
                    <td className={`${TD} font-mono text-xs text-fg-3`}>{pr.repo.split("/")[1] ?? pr.repo}</td>
                  )}
                  <td className={TD}>
                    <span className="inline-flex items-center gap-2 text-fg-3">
                      <Avatar name={pr.author} />
                      {pr.author}
                    </span>
                  </td>
                  <td className={TD}>
                    <MyReviewBadge state={pr.myReview} isAuthor={!!viewer && pr.author.toLowerCase() === viewer.login.toLowerCase()} />
                  </td>
                  <td className={`${TD} font-mono text-xs`}>
                    <span className="text-success-ink">+{formatCount(pr.additions)}</span> <span className="text-danger-ink">−{formatCount(pr.deletions)}</span>
                  </td>
                  <td className={`${TD} text-fg-3`} title={new Date(pr.updatedAt).toLocaleString()}>
                    {relativeTime(pr.updatedAt)}
                  </td>
                  <td className={TD}>
                    <StatusBadge status={pr.reviewStatus} />
                  </td>
                  <td className={`${TD} text-xs`}>
                    {pr.reviewStatus === "reported" ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-fg-2">
                        <span className="size-2 edge-hair bg-sev-medium-dot" />
                        {pr.openFindings} open
                        <span className="text-fg-3">·</span>
                        <span className="size-2 edge-hair bg-st-reported-dot" />
                        {pr.postedFindings} posted
                      </span>
                    ) : (
                      <span className="text-fg-3">—</span>
                    )}
                  </td>
                  <td className={`${TD} pr-3.5 text-right`}>
                    <span className="inline-flex items-center gap-1">
                      {canStartReview(pr) && (
                        <Button
                          size="sm"
                          iconOnly
                          aria-label={`Start review for #${pr.number}`}
                          disabled={startingReview === `${pr.repo}#${pr.number}`}
                          aria-keyshortcuts="R"
                          title="Start review (R)"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartReview(pr);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Icon name="play" className="size-3.5" />
                        </Button>
                      )}
                      <Icon name="chevronRight" className="inline size-4 text-fg-3 group-hover:text-fg" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}

function SortableTh({
  label,
  width,
  active,
  dir,
  onClick,
}: {
  label: string;
  width: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className={TH} style={{ width }} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 label-caps hover:bg-acid hover:text-acid-fg focus-ring">
        {label}
        <Icon name={dir === "asc" ? "chevronUp" : "chevronDown"} className={`size-3 ${active ? "" : "invisible"}`} />
      </button>
    </th>
  );
}

function EmptyState({ repo, filtered, onRefresh }: { repo: string; filtered: boolean; onRefresh: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 p-10 text-center [background:repeating-linear-gradient(0deg,transparent_0_43px,var(--color-subtle)_43px_44px),var(--color-surface)]">
      <div className="inline-flex size-12 items-center justify-center edge bg-acid text-acid-fg lift-sm">
        <Icon name="inbox" className="size-5" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-display text-[22px] uppercase leading-none">{filtered ? "No matching pull requests" : "No open pull requests"}</span>
        <span className="max-w-[380px] text-fg-2">
          {filtered ? (
            "No pull requests match the current filters. Try clearing one."
          ) : (
            <>
              <span className="font-mono">{repo}</span> has nothing waiting for review. Pick another repository or refresh.
            </>
          )}
        </span>
      </div>
      <Button variant="acid" className="mt-1" onClick={onRefresh}>
        <Icon name="refresh" />
        Refresh
      </Button>
    </div>
  );
}
