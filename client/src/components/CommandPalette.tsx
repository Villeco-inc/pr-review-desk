import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_REPOS } from "../../../shared/types";
import type { FindingDto, LocalReviewDto, PullRequestDto } from "../../../shared/types";
import { fetchJson } from "../lib/api";
import { rank } from "../lib/search";
import Icon, { type IconName } from "./ui/Icon";
import SeverityBadge from "./SeverityBadge";
import StatusBadge from "./StatusBadge";

export type JumpTarget =
  | { kind: "pr"; repo: string; number: number }
  | { kind: "finding"; repo: string; number: number; findingId: string }
  | { kind: "local-review"; repo: string; number: number; repoLabel: string; branch: string; base: string }
  | { kind: "local-finding"; repo: string; number: number; repoLabel: string; branch: string; base: string; findingId: string }
  | { kind: "local-branch"; repoLabel: string; branch: string }
  | { kind: "pick-repos" };

type Group = "Actions" | "Pull requests" | "Local branches" | "Findings";
const GROUPS: Group[] = ["Actions", "Pull requests", "Local branches", "Findings"];

const ACTIONS: Item[] = [
  {
    id: "action:pick-repos",
    group: "Actions",
    icon: "repo",
    title: "Pick repositories",
    meta: "choose which repositories the pull request list follows",
    target: { kind: "pick-repos" },
  },
];
const PER_GROUP = 8;

interface Item {
  id: string;
  group: Group;
  icon: IconName;
  title: string;
  meta: string;
  badge?: { status: string } | { severity: string };
  target: JumpTarget;
}

interface LocalRepo {
  label: string;
  path: string;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const JUMP_KEY_LABEL = isMac ? "⌘K" : "Ctrl K";

// Kept across openings so the palette shows the last index immediately while it refreshes.
let cachedIndex: Item[] = [];

const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null);

interface FindingSource {
  repo: string;
  number: number;
  label: string;
  local: null | { repoLabel: string; branch: string; base: string };
}

// Findings need one request per review.
async function findingItems(sources: FindingSource[]): Promise<Item[]> {
  const results = await Promise.all(
    sources.map((s) => settle(fetchJson<{ findings: FindingDto[] }>(`/api/reviews/${s.repo}/${s.number}`)).then((d) => ({ s, findings: d?.findings ?? [] })))
  );
  return results.flatMap(({ s, findings }) =>
    findings.map(
      (f): Item => ({
        id: `f:${f.id}`,
        group: "Findings",
        icon: "alert",
        title: f.title,
        meta: `${s.label} · ${f.file}${f.startLine ? `:${f.startLine}` : ""}`,
        badge: { severity: f.severity },
        target: s.local
          ? { kind: "local-finding", repo: s.repo, number: s.number, ...s.local, findingId: f.id }
          : { kind: "finding", repo: s.repo, number: s.number, findingId: f.id },
      })
    )
  );
}

// Pull requests and local branches load on their own, so a slow side never holds the other back.
async function loadIndex(onUpdate: (items: Item[]) => void): Promise<void> {
  const lanes = { prs: [] as Item[], prFindings: [] as Item[], local: [] as Item[], localFindings: [] as Item[] };
  const publish = () => onUpdate([...ACTIONS, ...lanes.prs, ...lanes.local, ...lanes.prFindings, ...lanes.localFindings]);

  const loadPrs = async () => {
    const prs = (await settle(fetchJson<PullRequestDto[]>(`/api/prs?repo=${ALL_REPOS}`))) ?? [];
    lanes.prs = prs.map(
      (pr): Item => ({
        id: `pr:${pr.repo}#${pr.number}`,
        group: "Pull requests",
        icon: "pullRequest",
        title: pr.title,
        meta: `${pr.repo.split("/").pop()} #${pr.number} · ${pr.author}`,
        badge: pr.reviewStatus !== "none" ? { status: pr.reviewStatus } : undefined,
        target: { kind: "pr", repo: pr.repo, number: pr.number },
      })
    );
    publish();

    lanes.prFindings = await findingItems(
      prs
        .filter((pr) => pr.reviewStatus === "reported")
        .map((pr) => ({ repo: pr.repo, number: pr.number, label: `${pr.repo.split("/").pop()} #${pr.number}`, local: null }))
    );
    publish();
  };

  const loadLocal = async () => {
    const [localRepos, localReviews] = await Promise.all([
      settle(fetchJson<LocalRepo[]>("/api/local/repos")),
      settle(fetchJson<LocalReviewDto[]>("/api/local/reviews")),
    ]);
    const branchLists = await Promise.all(
      (localRepos ?? []).map((r) =>
        settle(fetchJson<{ branches: { name: string }[] }>(`/api/local/branches?repo=${encodeURIComponent(r.label)}`)).then((d) => ({
          label: r.label,
          branches: d?.branches ?? [],
        }))
      )
    );

    const labelFor = (repoId: string) => (localRepos ?? []).find((r) => repoId.startsWith(`local/${r.label}-`))?.label ?? "";

    // A branch that already has a review opens that review; the others open the form preselected.
    const items: Item[] = [];
    const reviewed = new Set<string>();
    for (const r of localReviews ?? []) {
      const repoLabel = labelFor(r.repo);
      const branch = r.branch || r.title;
      reviewed.add(`${repoLabel}:${branch}`);
      items.push({
        id: `lr:${r.id}`,
        group: "Local branches",
        icon: "branch",
        title: branch,
        meta: `${repoLabel}${r.base ? ` · → ${r.base}` : ""} · review`,
        badge: { status: r.status },
        target: { kind: "local-review", repo: r.repo, number: r.number, repoLabel, branch, base: r.base || "main" },
      });
    }
    for (const { label, branches } of branchLists) {
      for (const b of branches) {
        if (reviewed.has(`${label}:${b.name}`)) continue;
        items.push({
          id: `lb:${label}:${b.name}`,
          group: "Local branches",
          icon: "branch",
          title: b.name,
          meta: `${label} · no review yet`,
          target: { kind: "local-branch", repoLabel: label, branch: b.name },
        });
      }
    }
    lanes.local = items;
    publish();

    lanes.localFindings = await findingItems(
      (localReviews ?? [])
        .filter((r) => r.totalFindings > 0)
        .map((r) => {
          const repoLabel = labelFor(r.repo);
          const branch = r.branch || r.title;
          return { repo: r.repo, number: r.number, label: `${repoLabel} · ${branch}`, local: { repoLabel, branch, base: r.base || "main" } };
        })
    );
    publish();
  };

  await Promise.all([loadPrs(), loadLocal()]);
}

export default function CommandPalette({ open, onClose, onJump }: { open: boolean; onClose: () => void; onJump: (target: JumpTarget) => void }) {
  const [items, setItems] = useState<Item[]>(cachedIndex.length ? cachedIndex : ACTIONS);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setLoading(true);
    let cancelled = false;
    loadIndex((next) => {
      cachedIndex = next;
      if (!cancelled) setItems(next);
    }).finally(() => !cancelled && setLoading(false));
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  // Grouped, ranked, capped per group; `flat` is the keyboard order.
  const { groups, flat } = useMemo(() => {
    const byGroup = GROUPS.map((g) => {
      const inGroup = items.filter((i) => i.group === g);
      // With no query, lead with PRs and local reviews; findings only show up when searched for.
      const matched = query.trim() ? rank(inGroup, query, (i) => [i.title, i.meta]) : g === "Findings" ? [] : inGroup.filter((i) => i.target.kind !== "local-branch");
      return { group: g, items: matched.slice(0, PER_GROUP), total: matched.length };
    }).filter((g) => g.items.length > 0);
    return { groups: byGroup, flat: byGroup.flatMap((g) => g.items) };
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    onJump(item.target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop; the list is driven by the arrows
    }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-fg/40 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        className="flex max-h-[72vh] w-full max-w-[680px] flex-col edge bg-surface lift focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-primary"
        onMouseDown={(e) => {
          e.stopPropagation();
          // Keep focus in the input when clicking the list, so typing and the arrows keep working.
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="flex h-[54px] shrink-0 items-center gap-3 edge-b px-4">
          <Icon name="search" className="size-4 shrink-0 text-fg-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a pull request, branch or finding…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
            role="combobox"
            aria-expanded="true"
            aria-controls="jump-results"
            aria-activedescendant={flat[active] ? `jump-${flat[active].id}` : undefined}
            aria-autocomplete="list"
          />
          {loading && <span className="label-caps text-fg-3">Loading…</span>}
        </div>

        <div ref={listRef} id="jump-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto">
          {flat.length === 0 && (
            <div className="px-4 py-6 text-center text-fg-2">
              {loading && items.length === 0 ? "Loading pull requests, branches and findings…" : query.trim() ? "Nothing matches." : "Type to search."}
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className={`flex h-7 items-center gap-2 edge-b bg-subtle px-4 label-caps text-fg-2 ${gi > 0 ? "edge-t" : ""}`}>
                {g.group}
                <span className="font-mono tracking-normal text-fg-3">{g.total > g.items.length ? `${g.items.length} of ${g.total}` : g.total}</span>
              </div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const on = i === active;
                return (
                  <div
                    key={item.id}
                    id={`jump-${item.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={`flex h-12 cursor-pointer items-center gap-3 edge-soft-b px-4 last:border-b-0 ${on ? "bg-row-hover" : ""}`}
                  >
                    <Icon name={item.icon} className="size-4 shrink-0 text-fg-3" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate font-medium ${item.group === "Local branches" ? "font-mono text-[13px]" : ""}`}>{item.title}</span>
                      <span className={`truncate font-mono text-[11px] ${on ? "text-fg-2" : "text-fg-3"}`}>{item.meta}</span>
                    </div>
                    {item.badge && ("status" in item.badge ? <StatusBadge status={item.badge.status} /> : <SeverityBadge severity={item.badge.severity} />)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 edge-t bg-subtle px-4 label-caps text-fg-2">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>Esc close</span>
          <span className="ml-auto font-mono tracking-normal">{JUMP_KEY_LABEL}</span>
        </div>
      </div>
    </div>
  );
}
