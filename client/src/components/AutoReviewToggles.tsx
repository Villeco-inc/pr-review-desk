import { invalidateCache, useMutation, useQuery } from "../hooks/useApi";
import Button from "./ui/Button";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toast";
import type { WatchSettings, WatchSettingsDto } from "../../../shared/types";

const URL = "/api/notifications/settings";

function useAutoReviewSettings() {
  const { data, refetch } = useQuery<WatchSettingsDto>(URL, [], 0);
  const save = useMutation<WatchSettingsDto>(URL, "PUT");
  const { toast } = useToast();
  const update = async (patch: Partial<WatchSettings>) => {
    try {
      await save.mutate(patch);
      invalidateCache(URL);
      refetch();
    } catch (err) {
      toast({ kind: "error", message: `Could not save: ${(err as Error).message}` });
    }
  };
  return { settings: data, update, saving: save.loading };
}

/** General on/off for automatic reviews, in the header; the repositories switched on are kept while it is off. */
export function AutoReviewSwitch() {
  const { settings, update, saving } = useAutoReviewSettings();
  if (!settings) return null;
  const on = !settings.autoReviewPaused;
  return (
    <Button size="sm" variant={on ? "quiet" : "plain"} aria-pressed={on} disabled={saving} onClick={() => update({ autoReviewPaused: on })} title={on ? "Pause every automatic review" : "Resume automatic reviews"}>
      <Icon name={on ? "play" : "stop"} />
      Auto-review {on ? "on" : "paused"}
    </Button>
  );
}

/** "Don't review this PR": automatic reviews skip it on every push until switched back. */
export function MutePrToggle({ repo, number }: { repo: string; number: number }) {
  const { settings, update, saving } = useAutoReviewSettings();
  if (!settings || !settings.autoReviewRepos.includes(repo)) return null;
  const key = `${repo}#${number}`;
  const muted = settings.autoReviewMutedPrs.includes(key);
  const next = muted ? settings.autoReviewMutedPrs.filter((k) => k !== key) : [...settings.autoReviewMutedPrs, key];
  return (
    <Button size="sm" variant="quiet" aria-pressed={muted} disabled={saving} onClick={() => update({ autoReviewMutedPrs: next })}>
      <Icon name={muted ? "refresh" : "x"} />
      {muted ? "Review this PR again" : "Don't auto-review this PR"}
    </Button>
  );
}
