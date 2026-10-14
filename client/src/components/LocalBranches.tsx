import { useEffect } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import type { LocalDiffSummaryDto, LocalReviewDto, ReviewDto } from "../../../shared/types";
import StatusBadge from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Eyebrow } from "./ui/Card";
import Combobox from "./ui/Combobox";
import { Input, Select } from "./ui/Field";
import Icon from "./ui/Icon";
import { TableSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { relativeTime } from "../lib/format";
import { ShellActions, useRailCount } from "./AppShell";
import { moveFocus, useHotkeys } from "../hooks/useHotkeys";
import { LAUNCH_DEFAULTS, LAUNCH_KEY, useStoredState } from "../lib/storage";
import type { LocalSearch } from "../lib/url-state";
import NotFound from "./ui/NotFound";

interface LocalRepo {
  label: string;
  path: string;
}

interface LocalBranch {
  name: string;
  current: boolean;
}

const TH = "h-10 whitespace-nowrap bg-subtle px-3 text-left label-caps text-fg-2 edge-b first:pl-4";
// Row dividers are the one hairline allowed: they sit inside a bordered block.
const TD = "h-[var(--row-h)] whitespace-nowrap px-3 align-middle edge-soft-b group-last:border-b-0 first:pl-4";
// The row is the click target; the branch name is the real control, so its name is the accessible name.
// Hover fills the cells (acid in brutalism) with no transition; keyboard focus draws a blue bar on the first cell.
const ROW =
  "group cursor-pointer hover:[&>td]:bg-row-hover has-[:focus-visible]:[&>td]:bg-row-hover has-[:focus-visible]:[&>td:first-child]:shadow-[inset_5px_0_0_var(--color-primary)]";

function branchFromRepoId(repoId: string): string {
  const match = repoId.match(/^local\/(.+)-[a-f0-9]{10}$/);
  return match ? match[1] : repoId;
}

export default function LocalBranches({
  label,
  search,
  onRepoChange,
  onSelectionChange,
  onRemember,
  onForgetRepo,
  onSelectReview,
}: {
  /** The repo from the path; undefined on bare `/local`, which settles on the first repo. */
  label?: string;
  /** Branch and base from the query. */
  search: LocalSearch;
  onRepoChange: (label: string) => void;
  onSelectionChange: (next: LocalSearch) => void;
  /** Called with every settled selection of a configured repo, for the next bare `/local`. */
  onRemember: (label: string, selection: LocalSearch) => void;
  /** Called when the path names a repo that is not configured, before offering the way back. */
  onForgetRepo: (label: string) => void;
  onSelectReview: (args: { repo: string; number: number; repoLabel: string; branch: string; base: string }) => void;
}) {
  const { data: repos } = useQuery<LocalRepo[]>("/api/local/repos");
  const branch = search.branch ?? "";
  const base = search.base ?? "";
  const setBranch = (b: string) => onSelectionChange({ ...search, branch: b });
  const setBase = (b: string) => onSelectionChange({ ...search, base: b });
  const [launch, setLaunch] = useStoredState("local", LAUNCH_KEY, LAUNCH_DEFAULTS);
  const { model, effort, skills: skillsInput } = launch;
  const setModel = (model: string) => setLaunch((l) => ({ ...l, model }));
  const setEffort = (effort: string) => setLaunch((l) => ({ ...l, effort }));
  const setSkillsInput = (skills: string) => setLaunch((l) => ({ ...l, skills }));
  const { toast } = useToast();

  const unknownRepo = !!label && !!repos && !repos.some((r) => r.label === label);
  const repo = unknownRepo ? "" : label || repos?.[0]?.label || "";

  useEffect(() => {
    if (!label && repo) onRepoChange(repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, repo]);

  useEffect(() => {
    if (label && repos && !unknownRepo) onRemember(label, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, repos, unknownRepo, search.branch, search.base]);

  useEffect(() => {
    if (unknownRepo && label) onForgetRepo(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknownRepo, label]);

  const { data: branchData, loading: branchesLoading } = useQuery<{ branches: LocalBranch[]; defaultBase: string }>(
    repo ? `/api/local/branches?repo=${encodeURIComponent(repo)}` : null,
    [repo]
  );
  useRailCount("local", branchData?.branches.length);

  // A remembered branch or base that no longer exists falls back silently to the defaults.
  useEffect(() => {
    if (!branchData) return;
    const exists = (name: string) => branchData.branches.some((b) => b.name === name);
    const nextBranch = branch && exists(branch) ? branch : branchData.branches.find((b) => b.current)?.name ?? branchData.branches[0]?.name ?? "";
    const nextBase = base && exists(base) ? base : branchData.defaultBase;
    if (nextBranch !== branch || nextBase !== base) onSelectionChange({ branch: nextBranch, base: nextBase });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchData]);

  const { data: latest, refetch: refetchLatest } = useQuery<(ReviewDto & { findings: unknown[] }) | null>(
    repo && branch ? `/api/local/reviews/latest?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}` : null,
    [repo, branch]
  );

  const {
    data: allReviews,
    loading: reviewsLoading,
    refetch: refetchReviews,
  } = useQuery<LocalReviewDto[]>(
    repo ? `/api/local/reviews?repo=${encodeURIComponent(repo)}` : null,
    [repo]
  );

  const startReview = useMutation<{ repo: string; number: number }>("/api/local/reviews", "POST");
  const isRunning = latest?.status === "running" || latest?.status === "queued";
  const { data: summary, loading: summaryLoading } = useQuery<LocalDiffSummaryDto>(
    repo && branch && base && branch !== base
      ? `/api/local/diff-summary?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`
      : null,
    [repo, branch, base],
    5_000
  );
  const nothingToReview = !!summary && summary.files === 0;
  const canStart = !!branch && !!base && branch !== base && !isRunning && !startReview.loading && !nothingToReview;

  const handleStart = async () => {
    const skills = skillsInput.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await startReview.mutate({ repo, branch, base, skills, model, effort });
      toast({ kind: "success", message: `Review started for ${branch}` });
      refetchLatest();
      refetchReviews();
    } catch (err) {
      toast({ kind: "error", message: `Could not start local review: ${(err as Error).message}` });
    }
  };

  useHotkeys({
    j: () => moveFocus("[data-row-nav]", 1),
    k: () => moveFocus("[data-row-nav]", -1),
    // History rows are past reviews, so R runs the branch pair selected in the form above.
    r: () => canStart && handleStart(),
  });

  if (unknownRepo) {
    return (
      <NotFound
        title="Local repository not found"
        detail={`"${label}" is not one of the configured local repositories.`}
        backLabel="All local branches"
        onBack={() => onRepoChange(repos?.[0]?.label ?? "")}
      />
    );
  }

  return (
    <main className="flex flex-col gap-5 px-10 pb-10 pt-7">
      <ShellActions>
        <Button size="sm" onClick={refetchReviews} disabled={reviewsLoading}>
          <Icon name="refresh" className={reviewsLoading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </ShellActions>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[34px] uppercase leading-none tracking-[0.01em]">Local branches</h1>
        <span className="text-xs text-fg-3">Review a local branch before opening a pull request.</span>
      </div>

      <Card className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 edge-b px-5 py-3.5">
          <Select id="local-repo" icon="repo" wrapperClassName="w-56" value={repo} onChange={(e) => onRepoChange(e.target.value)}>
            {(repos ?? []).map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </Select>
          <Combobox
            icon="branch"
            placeholder="Branch…"
            wrapperClassName="w-64"
            value={branch}
            onChange={setBranch}
            disabled={branchesLoading}
            options={(branchData?.branches ?? []).map((b) => ({
              value: b.name,
              label: b.name,
              hint: b.current ? "current" : undefined,
            }))}
          />
          <Icon name="arrowRight" className="size-3.5 text-fg-3" />
          <Combobox
            icon="branch"
            placeholder="Base…"
            wrapperClassName="w-48"
            value={base}
            onChange={setBase}
            disabled={branchesLoading}
            options={(branchData?.branches ?? []).map((b) => ({
              value: b.name,
              label: b.name,
            }))}
          />
        </div>

        <div className="flex items-center gap-2 edge-b bg-subtle px-5 py-3">
          <Select id="local-model" icon="cpu" label="Model" wrapperClassName="w-[168px]" value={model} onChange={(e) => setModel(e.target.value)} disabled={isRunning}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </Select>
          <Select id="local-effort" icon="gauge" label="Effort" wrapperClassName="w-[248px]" value={effort} onChange={(e) => setEffort(e.target.value)} disabled={isRunning}>
            <option value="quick">Quick · low effort</option>
            <option value="standard">Standard · medium effort</option>
            <option value="thorough">Thorough · high effort</option>
            <option value="exhaustive">Exhaustive · max effort</option>
          </Select>
          <Input
            id="local-skills"
            icon="star"
            wrapperClassName="w-[260px]"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            placeholder="Skills, comma-separated (optional)"
            disabled={isRunning}
          />
          <Button variant="primary" onClick={handleStart} disabled={!canStart} aria-keyshortcuts="R" title="Start review (R)">
            <Icon name={latest?.status === "failed" ? "refresh" : "play"} />
            {isRunning ? "Review running…" : latest?.status === "failed" ? "Retry review" : "Start review"}
          </Button>
          {latest && <StatusBadge status={latest.status} />}
        </div>

        {summary && branch !== base && (
          <div className={`flex items-center gap-2 edge-t px-5 py-3 text-xs ${nothingToReview ? "bg-danger-soft text-fg" : "text-fg-2"}`}>
            <Icon name={nothingToReview ? "alert" : "file"} className={`size-3.5 ${nothingToReview ? "text-danger-ink" : "text-fg-3"}`} />
            {nothingToReview ? (
              <span>
                Nothing to review: <span className="font-mono">{branch}</span> has no commits of its own beyond{" "}
                <span className="font-mono">{summary.baseRef}</span>
                {summary.worktree ? " and no uncommitted changes." : ", and it is not checked out in a worktree the app can read."}
              </span>
            ) : (
              <span>
                Will review {summary.files} file{summary.files > 1 ? "s" : ""}:{" "}
                {[
                  summary.ownCommits > 0 && `${summary.ownCommits} commit${summary.ownCommits > 1 ? "s" : ""}`,
                  summary.uncommittedFiles > 0 && `${summary.uncommittedFiles} uncommitted file${summary.uncommittedFiles > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" + ")}{" "}
                vs <span className="font-mono">{summary.baseRef}</span>
                {summary.worktree && (
                  <>
                    {" "}
                    · from <span className="font-mono">{summary.worktree.split("/").slice(-2).join("/")}</span>
                  </>
                )}
                {summaryLoading ? " …" : ""}
              </span>
            )}
          </div>
        )}

        {latest && (
          <div className="flex items-center gap-3 px-5 py-3">
            <Eyebrow>Last review</Eyebrow>
            <span className="font-mono text-xs text-fg-3">{relativeTime(latest.updatedAt)}</span>
            <Button
              size="sm"
              variant="acid"
              className="ml-auto"
              onClick={() => onSelectReview({ repo: latest.repo, number: latest.number, repoLabel: repo, branch, base })}
            >
              View
              <Icon name="chevronRight" />
            </Button>
            <Button size="sm" variant="quiet" iconOnly aria-label="Refresh status" onClick={refetchLatest}>
              <Icon name="refresh" />
            </Button>
          </div>
        )}

        {branch && branch === base && (
          <div className="flex items-center gap-2 edge-t bg-acid-soft px-5 py-3 text-xs text-fg-2">
            <Icon name="alert" className="size-3.5 text-fg" />
            Pick a different base branch to diff against.
          </div>
        )}
      </Card>

      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-[22px] uppercase leading-none">Review history</h2>
        <span className="font-mono text-xs text-fg-3">
          {reviewsLoading
            ? "Loading…"
            : `${allReviews?.length ?? 0} review${(allReviews?.length ?? 0) !== 1 ? "s" : ""}`}
        </span>
      </div>

      <Card className="overflow-hidden">
        {reviewsLoading && !allReviews ? (
          <TableSkeleton rows={4} cols={5} />
        ) : !allReviews || allReviews.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 p-10 text-center">
            <div className="inline-flex size-12 items-center justify-center edge bg-acid text-acid-fg lift-sm">
              <Icon name="inbox" className="size-5" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-display text-[22px] uppercase leading-none">No reviews yet</span>
              <span className="max-w-[380px] text-fg-2">
                Start a review on a branch above to see it here.
              </span>
            </div>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Branch</th>
                <th className={`${TH} w-[120px]`}>Status</th>
                <th className={`${TH} w-[100px]`}>Findings</th>
                <th className={`${TH} w-[140px]`}>Reviewed</th>
                <th className={`${TH} w-11`} />
              </tr>
            </thead>
            <tbody>
              {allReviews.map((r) => {
                const open = () =>
                  onSelectReview({
                    repo: r.repo,
                    number: r.number,
                    repoLabel: repo,
                    branch: r.branch || r.title,
                    base: r.base || base || "main",
                  });
                return (
                  <tr key={r.id} onClick={open} className={ROW}>
                    <td className={`${TD} max-w-0`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon name="branch" className="size-3.5 shrink-0 text-fg-3" />
                        <button
                          type="button"
                          data-row-nav
                          className="min-w-0 truncate text-left font-mono text-xs font-medium outline-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            open();
                          }}
                        >
                          {r.branch || branchFromRepoId(r.repo)}
                        </button>
                        {r.base && <span className="shrink-0 font-mono text-[11px] text-fg-3">→ {r.base}</span>}
                      </span>
                    </td>
                    <td className={TD}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`${TD} text-xs`}>
                      {r.totalFindings > 0 ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-fg-2">
                          <span className="size-2 edge-hair bg-sev-medium-dot" />
                          {r.openFindings} open
                        </span>
                      ) : (
                        <span className="text-fg-3">—</span>
                      )}
                    </td>
                    <td className={`${TD} text-fg-3`} title={new Date(r.updatedAt).toLocaleString()}>
                      {relativeTime(r.updatedAt)}
                    </td>
                    <td className={`${TD} pr-3.5 text-right text-fg-3 group-hover:text-fg`}>
                      <Icon name="chevronRight" className="inline size-4" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
