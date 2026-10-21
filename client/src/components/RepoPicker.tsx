import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import { reposChanged } from "../hooks/useRepos";
import Button from "./ui/Button";
import Icon from "./ui/Icon";
import Skeleton from "./ui/Skeleton";
import { Checkbox } from "./ui/Field";
import { useToast } from "./ui/Toast";

/**
 * Picks the repositories the PR list follows, among every repository the GitHub token can see.
 * On first launch nothing is picked yet and the list would be empty, so it cannot be dismissed.
 */
export default function RepoPicker({ selected, required, onClose }: { selected: string[]; required: boolean; onClose: () => void }) {
  const { data: available, loading, error, refetch } = useQuery<string[]>("/api/repos/available", [], 5 * 60_000);
  const [picked, setPicked] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const save = useMutation<string[]>("/api/repos", "PUT");
  const { toast } = useToast();

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Picked repositories come first, so unticking one never means scrolling to find it. They are the ones
  // picked when the picker opened: a selection changed elsewhere meanwhile must not move rows under the cursor.
  const [openedWith] = useState(selected);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...new Set([...openedWith, ...(available ?? [])])];
    const matches = q ? all.filter((r) => r.toLowerCase().includes(q)) : all;
    return [...matches.filter((r) => openedWith.includes(r)), ...matches.filter((r) => !openedWith.includes(r))];
  }, [available, openedWith, query]);

  const toggle = (repo: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });

  const submit = async () => {
    if (picked.size === 0 || save.loading) return;
    try {
      await save.mutate({ repos: [...picked] });
      reposChanged();
      toast({ kind: "success", message: `Following ${picked.size} ${picked.size === 1 ? "repository" : "repositories"}` });
      onClose();
    } catch (err) {
      toast({ kind: "error", message: `Could not save the repositories: ${(err as Error).message}` });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !required) {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-fg/40 px-4 pt-[10vh]" onMouseDown={required ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-picker-title"
        className="flex max-h-[76vh] w-full max-w-[560px] flex-col edge bg-surface lift"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex shrink-0 flex-col gap-1 edge-b px-5 py-4">
          <h2 id="repo-picker-title" className="font-display text-[22px] uppercase leading-none">
            Pick your repositories
          </h2>
          <p className="text-fg-2">
            {required ? "Pull requests are listed from the repositories you tick. You can change them later from Repositories in the rail." : "Tick the repositories whose pull requests you want to see."}
          </p>
        </div>

        <label className="flex h-[46px] shrink-0 items-center gap-3 edge-b px-5">
          <Icon name="search" className="size-4 shrink-0 text-fg-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name…"
            aria-label="Filter repositories"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
          />
        </label>

        <div role="group" aria-label="Repositories" className="min-h-[120px] flex-1 overflow-y-auto">
          {loading && !available ? (
            <div className="flex flex-col gap-3 p-5" aria-label="Loading repositories">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5 w-2/3" />
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-start gap-3 p-5">
              <span className="font-medium">Could not list your repositories</span>
              <span className="font-mono text-xs text-danger-ink">{error}</span>
              <Button size="sm" onClick={refetch}>
                <Icon name="refresh" />
                Retry
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <div className="px-5 py-6 text-center text-fg-2">{query.trim() ? `No repository matches “${query.trim()}”.` : "This GitHub account sees no repository."}</div>
          ) : (
            shown.map((repo) => {
              const checked = picked.has(repo);
              return (
                <div
                  key={repo}
                  onClick={() => toggle(repo)}
                  className="flex h-10 cursor-pointer items-center gap-3 edge-soft-b px-5 last:border-b-0 hover:bg-row-hover"
                >
                  <Checkbox checked={checked} onChange={() => toggle(repo)} ariaLabel={repo} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{repo}</span>
                </div>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 edge-t bg-subtle px-5 py-3">
          <span className="label-caps text-fg-2">{picked.size === 0 ? "None picked" : `${picked.size} picked`}</span>
          <div className="ml-auto flex items-center gap-2">
            {!required && <Button onClick={onClose}>Cancel</Button>}
            <Button variant="primary" disabled={picked.size === 0 || save.loading} onClick={submit}>
              {save.loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
