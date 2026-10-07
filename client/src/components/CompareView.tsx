import { useEffect } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import type { CompareSummaryDto, FindingDto, RepoRefsDto, ReviewDto } from "../../../shared/types";
import StatusBadge from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Chip, Eyebrow } from "./ui/Card";
import Combobox from "./ui/Combobox";
import { Input, Select } from "./ui/Field";
import Icon from "./ui/Icon";
import NotFound from "./ui/NotFound";
import { CardSkeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";
import { ShellActions } from "./AppShell";
import { relativeTime } from "../lib/format";
import { LAUNCH_DEFAULTS, LAUNCH_KEY, useStoredState } from "../lib/storage";
import type { CompareSearch } from "../lib/url-state";
import type { CompareReviewRef } from "../nav";

type LatestCompare = (ReviewDto & { findings: FindingDto[]; base: string }) | null;

/** Review a range with no pull request: by default, what the head branch has that production does not. */
export default function CompareView({
  repo,
  search,
  onRepoChange,
  onSearchChange,
  onRemember,
  onSelectReview,
  onBackToList,
}: {
  repo: string;
  search: CompareSearch;
  onRepoChange: (repo: string) => void;
  onSearchChange: (next: CompareSearch) => void;
  onRemember: (repo: string, head: string | undefined) => void;
  onSelectReview: (ref: CompareReviewRef) => void;
  onBackToList: () => void;
}) {
  const { data: repos } = useQuery<string[]>("/api/repos");
  const githubRepos = (repos ?? []).filter((r) => !r.startsWith("org:"));
  const unknownRepo = !!repos && !githubRepos.includes(repo);
  const { data: refs, error: refsError, loading: refsLoading } = useQuery<RepoRefsDto>(
    unknownRepo ? null : `/api/compare/refs?repo=${encodeURIComponent(repo)}`,
    [repo],
    60_000
  );
  const [launch, setLaunch] = useStoredState("local", LAUNCH_KEY, LAUNCH_DEFAULTS);
  const { toast } = useToast();

  const head = search.head ?? "";
  const base = search.base ?? "";

  // Once the refs are known, settle the defaults into the URL: the default branch against the tag in production.
  useEffect(() => {
    if (!refs) return;
    const next = {
      head: head && refs.branches.includes(head) ? head : refs.defaultBranch,
      base: base || refs.production?.tag || "",
    };
    if (next.head !== head || next.base !== base) onSearchChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs]);

  useEffect(() => {
    if (refs && head) onRemember(repo, head);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, repo, head]);

  const rangeReady = !!refs && !!head && !!base && head !== base;
  const { data: summary, error: summaryError, loading: summaryLoading } = useQuery<CompareSummaryDto>(
    rangeReady ? `/api/compare/summary?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}` : null,
    [repo, base, head],
    15_000
  );
  const { data: latest, refetch: refetchLatest } = useQuery<LatestCompare>(
    head ? `/api/compare/reviews/latest?repo=${encodeURIComponent(repo)}&head=${encodeURIComponent(head)}` : null,
    [repo, head]
  );

  const startReview = useMutation<{ repo: string; number: number }>("/api/compare/reviews", "POST");
  const isRunning = latest?.status === "running" || latest?.status === "queued";
  const nothingToReview = !!summary && summary.files.length === 0;
  const tooLarge = !!summary && summary.truncated;
  const canStart = rangeReady && !!summary && !nothingToReview && !tooLarge && !isRunning && !startReview.loading;

  const handleStart = async () => {
    const skills = launch.skills.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await startReview.mutate({ repo, base, head, skills, model: launch.model, effort: launch.effort });
      toast({ kind: "success", message: `Review started for ${head} vs ${base}` });
      refetchLatest();
    } catch (err) {
      toast({ kind: "error", message: `Could not start the review: ${(err as Error).message}` });
    }
  };

  // Follow a running review until it settles.
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(refetchLatest, 3000);
    return () => clearInterval(t);
  }, [isRunning, refetchLatest]);

  if (unknownRepo) {
    return <NotFound title="Repository not configured" detail={`"${repo}" is not in REPOS.`} backLabel="Compare" onBack={onBackToList} />;
  }

  const production = refs?.production;
  const refOptions = [
    ...(refs?.tags ?? []).map((t) => ({ value: t, label: t, hint: t === production?.tag ? "production" : undefined })),
    ...(refs?.branches ?? []).map((b) => ({ value: b, label: b })),
  ];

  return (
    <main className="flex flex-col gap-5 px-10 pb-10 pt-7">
      <ShellActions>
        <Button size="sm" onClick={() => refetchLatest()}>
          <Icon name="refresh" />
          Refresh
        </Button>
      </ShellActions>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[34px] uppercase leading-none tracking-[0.01em]">Compare</h1>
        <span className="text-xs text-fg-3">Review what a branch has that another ref does not — by default, what is not in production yet.</span>
      </div>

      <Card className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 edge-b px-5 py-3.5">
          <Select id="compare-repo" icon="repo" wrapperClassName="w-64" value={repo} onChange={(e) => onRepoChange(e.target.value)} aria-label="Repository">
            {githubRepos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Combobox
            icon="branch"
            placeholder="Head…"
            wrapperClassName="w-64"
            value={head}
            onChange={(h) => onSearchChange({ ...search, head: h })}
            disabled={refsLoading}
            options={(refs?.branches ?? []).map((b) => ({ value: b, label: b, hint: b === refs?.defaultBranch ? "default" : undefined }))}
          />
          <Icon name="arrowRight" className="size-3.5 rotate-180 text-fg-3" />
          <Combobox
            icon="star"
            placeholder="Base: tag or branch…"
            wrapperClassName="w-60"
            value={base}
            onChange={(b) => onSearchChange({ ...search, base: b })}
            disabled={refsLoading}
            options={refOptions}
          />
          {production && base !== production.tag && (
            <Button size="sm" variant="quiet" onClick={() => onSearchChange({ ...search, base: production.tag })}>
              Use production ({production.tag})
            </Button>
          )}
        </div>

        {refsError && (
          <div role="alert" className="flex items-center gap-2 edge-b bg-danger-soft px-5 py-3 text-xs">
            <Icon name="alert" className="size-3.5 text-danger-ink" />
            Could not read the repository's tags and branches: <span className="font-mono">{refsError}</span>
          </div>
        )}

        {production && (
          <div className={`flex items-center gap-2 edge-b px-5 py-2.5 text-xs ${production.source === "latest-tag" ? "bg-acid-soft text-fg" : "text-fg-2"}`}>
            <Icon name={production.source === "latest-tag" ? "alert" : "checkCircle"} className="size-3.5 text-fg-3" />
            {production.source === "deployment" ? (
              <span>
                In production: <span className="font-mono">{production.tag}</span>, deployed {production.deployedAt ? relativeTime(production.deployedAt) : ""} (from
                GitHub's production deployments).
              </span>
            ) : (
              <span>
                GitHub has no production deployment on record for this repo, so <span className="font-mono">{production.tag}</span> is only the newest tag.
                Check it is the one deployed, or pick the base yourself.
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 edge-b bg-subtle px-5 py-3">
          <Select id="compare-model" icon="cpu" label="Model" wrapperClassName="w-[168px]" value={launch.model} onChange={(e) => setLaunch((l) => ({ ...l, model: e.target.value }))} disabled={isRunning}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </Select>
          <Select id="compare-effort" icon="gauge" label="Effort" wrapperClassName="w-[248px]" value={launch.effort} onChange={(e) => setLaunch((l) => ({ ...l, effort: e.target.value }))} disabled={isRunning}>
            <option value="quick">Quick · 1 turn</option>
            <option value="standard">Standard · 3 turns</option>
            <option value="thorough">Thorough · 10 turns</option>
            <option value="exhaustive">Exhaustive · 25 turns</option>
          </Select>
          <Input
            id="compare-skills"
            icon="star"
            wrapperClassName="w-[260px]"
            value={launch.skills}
            onChange={(e) => setLaunch((l) => ({ ...l, skills: e.target.value }))}
            placeholder="Skills, comma-separated (optional)"
            disabled={isRunning}
          />
          <Button variant="primary" onClick={handleStart} disabled={!canStart}>
            <Icon name={latest?.status === "failed" ? "refresh" : "play"} />
            {isRunning ? "Review running…" : latest?.status === "failed" ? "Retry review" : "Start review"}
          </Button>
          {latest && <StatusBadge status={latest.status} />}
        </div>

        {rangeReady && (summaryLoading && !summary ? (
          <div className="px-5 py-3 text-xs text-fg-3">Comparing {head} with {base} on GitHub…</div>
        ) : summaryError ? (
          <div role="alert" className="flex items-center gap-2 bg-danger-soft px-5 py-3 text-xs">
            <Icon name="alert" className="size-3.5 text-danger-ink" />
            <span className="font-mono">{summaryError}</span>
          </div>
        ) : summary && (
          <div className={`flex flex-col gap-2 px-5 py-3 text-xs ${nothingToReview || tooLarge ? "bg-danger-soft text-fg" : "text-fg-2"}`}>
            <span className="flex items-center gap-2">
              <Icon name={nothingToReview || tooLarge ? "alert" : "file"} className="size-3.5 text-fg-3" />
              {tooLarge ? (
                <span>
                  Too large to review: <span className="font-mono">{head}</span> is {summary.aheadBy.toLocaleString("en-US")} commits ahead of{" "}
                  <span className="font-mono">{base}</span>. GitHub truncates a comparison this big, so the review would miss changes. Pick a closer base.
                </span>
              ) : nothingToReview ? (
                <span>
                  Nothing to review: <span className="font-mono">{head}</span> has no changes beyond <span className="font-mono">{base}</span>.
                </span>
              ) : (
                <span>
                  Will review {summary.aheadBy} commit{summary.aheadBy > 1 ? "s" : ""} · {summary.files.length} file{summary.files.length > 1 ? "s" : ""}:{" "}
                  <span className="font-mono">{head}</span> since <span className="font-mono">{base}</span>
                  {summary.behindBy > 0 && ` (${head} is also ${summary.behindBy} commit${summary.behindBy > 1 ? "s" : ""} behind ${base}; those are not reviewed)`}
                </span>
              )}
            </span>
            {summary.commits.length > 0 && (
              <ul className="flex flex-col gap-0.5 pl-5 font-mono">
                {summary.commits
                  .slice()
                  .reverse()
                  .slice(0, 15)
                  .map((c) => (
                    <li key={c.sha} className="truncate">
                      <span className="text-fg-3">{c.sha.slice(0, 9)}</span> {c.message.split("\n")[0]}
                      {c.author && <span className="text-fg-3"> · {c.author}</span>}
                    </li>
                  ))}
                {summary.commits.length > 15 && <li className="text-fg-3">… and {summary.commits.length - 15} more</li>}
              </ul>
            )}
          </div>
        ))}

        {latest && (
          <div className="flex items-center gap-3 edge-t px-5 py-3">
            <Eyebrow>Last review</Eyebrow>
            <span className="font-mono text-xs text-fg-3">
              {latest.base ? `vs ${latest.base} · ` : ""}
              {relativeTime(latest.updatedAt)}
            </span>
            {latest.base && latest.base !== base && <Chip>older base</Chip>}
            <Button
              size="sm"
              variant="acid"
              className="ml-auto"
              onClick={() => onSelectReview({ repo: latest.repo, number: latest.number, ghRepo: repo, base: latest.base || base, head })}
            >
              View
              <Icon name="chevronRight" />
            </Button>
          </div>
        )}
      </Card>

      {!refs && refsLoading && <CardSkeleton lines={2} />}
    </main>
  );
}
