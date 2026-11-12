import { useEffect, useState } from "react";
import Button from "./ui/Button";
import Skeleton from "./ui/Skeleton";
import { Checkbox, Input, Select } from "./ui/Field";
import { useToast } from "./ui/Toast";
import { useMutation, useQuery } from "../hooks/useApi";
import { useRepos } from "../hooks/useRepos";
import type { WatchSettings, WatchSettingsDto } from "../../../shared/types";

/** GitHub polling and automatic review: how often to look, where to review by itself, and how much a day may cost. */
export default function WatchSettingsForm() {
  const { data, error, refetch } = useQuery<WatchSettingsDto>("/api/notifications/settings", [], 0);
  const { data: repos } = useRepos();
  const [draft, setDraft] = useState<WatchSettings | null>(null);
  const save = useMutation<WatchSettingsDto>("/api/notifications/settings", "PUT");
  const { toast } = useToast();

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  if (error) return <div role="alert" className="p-5 font-mono text-xs text-danger-ink">{error}</div>;
  if (!data || !draft) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-label="Loading settings">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  const set = (patch: Partial<WatchSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleRepo = (repo: string) =>
    set({ autoReviewRepos: draft.autoReviewRepos.includes(repo) ? draft.autoReviewRepos.filter((r) => r !== repo) : [...draft.autoReviewRepos, repo] });
  // A repository switched on and then unfollowed stays listed, so it can be switched off.
  const shown = [...new Set([...(repos ?? []), ...draft.autoReviewRepos])];
  const overCap = data.spentTodayUsd >= draft.dailyCapUsd;

  const submit = async () => {
    try {
      // The switches in the header and on a PR save themselves; this form must not overwrite them with stale values.
      const { autoReviewPaused: _paused, autoReviewMutedPrs: _muted, ...fields } = draft;
      const saved = await save.mutate(fields);
      setDraft(saved);
      refetch();
      toast({ kind: "success", message: "Settings saved" });
    } catch (err) {
      toast({ kind: "error", message: `Could not save: ${(err as Error).message}` });
    }
  };

  return (
    <div className="flex flex-col gap-5 p-5">
      <section className="flex flex-col gap-2">
        <h3 className="label-caps text-fg-2">GitHub polling</h3>
        <Input
          id="poll-seconds"
          label="Every"
          type="number"
          min={30}
          step={30}
          wrapperClassName="w-[220px]"
          value={draft.pollSeconds}
          onChange={(e) => set({ pollSeconds: Number(e.target.value) })}
        />
        <p className="text-fg-3">Seconds between two looks at the followed repositories (30 at least).</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="label-caps text-fg-2">Automatic review</h3>
        <p className="text-fg-3">When your review is requested, or new commits land on a PR the Desk reviewed, start a review by itself on:</p>
        <div role="group" aria-label="Automatic review repositories" className="edge">
          {shown.length === 0 ? (
            <div className="px-3 py-2 text-fg-3">No followed repository.</div>
          ) : (
            shown.map((repo) => (
              <div key={repo} onClick={() => toggleRepo(repo)} className="flex h-9 cursor-pointer items-center gap-3 edge-soft-b px-3 last:border-b-0 hover:bg-row-hover">
                <Checkbox checked={draft.autoReviewRepos.includes(repo)} onChange={() => toggleRepo(repo)} ariaLabel={`Automatic review on ${repo}`} />
                <span className="min-w-0 flex-1 truncate font-mono text-[length:calc(13px*var(--font-scale))]">{repo}</span>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select id="auto-model" icon="cpu" label="Model" wrapperClassName="w-[168px]" value={draft.autoReviewModel ?? "sonnet"} onChange={(e) => set({ autoReviewModel: e.target.value })}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </Select>
          <Select id="auto-effort" icon="gauge" label="Effort" wrapperClassName="w-[248px]" value={draft.autoReviewEffort ?? "standard"} onChange={(e) => set({ autoReviewEffort: e.target.value })}>
            <option value="quick">Quick · low effort</option>
            <option value="standard">Standard · medium effort</option>
            <option value="thorough">Thorough · high effort</option>
            <option value="exhaustive">Exhaustive · max effort</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="daily-cap"
            label="Daily cap $"
            type="number"
            min={0}
            step={0.5}
            wrapperClassName="w-[200px]"
            value={draft.dailyCapUsd}
            onChange={(e) => set({ dailyCapUsd: Number(e.target.value) })}
          />
          <span className={`font-mono text-[length:calc(12px*var(--font-scale))] ${overCap ? "text-danger-ink" : "text-fg-2"}`}>
            Spent today (UTC): ${data.spentTodayUsd.toFixed(2)}
            {overCap ? " — cap reached, no automatic review" : ""}
          </span>
        </div>
      </section>

      <div className="flex justify-end">
        <Button variant="primary" disabled={save.loading} onClick={submit}>
          {save.loading ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
