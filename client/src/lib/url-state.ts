// What the URL carries: which screen (the path) and its list filters (the query).
// Everything else a screen remembers lives in storage — see lib/storage.ts.

import { readStored, writeStored } from "./storage";
import { localMemory, prsMemory } from "./view-memory";

export type Search = Record<string, string | string[]>;

/** Repeated keys become arrays (`?author=a&author=b`), so values may contain commas. */
export function parseSearch(searchStr: string): Search {
  const out: Search = {};
  for (const [k, v] of new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item));
    else params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : Array.isArray(v) ? str(v[0]) : undefined);
const list = (v: unknown): string[] | undefined => {
  const items = (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string" && x !== "");
  return items.length > 0 ? [...new Set(items)] : undefined;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
  const s = str(v);
  return allowed.includes(s as T) ? (s as T) : undefined;
};

// ── Pull request list ─────────────────────────────────────────────────────────

export const PR_STATUSES = ["draft", "approved", "changes_requested", "review_required"] as const;
export const SORT_KEYS = ["number", "updated", "review"] as const;
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = (typeof SORT_DIRS)[number];

export interface PrListSearch {
  repo?: string;
  author?: string[];
  status?: string[];
  label?: string[];
  sort?: SortKey;
  dir?: SortDir;
}

/** Filters remembered per repo; the repo itself is remembered separately. */
export type PrFilters = Omit<PrListSearch, "repo">;

export function validatePrListSearch(raw: Record<string, unknown>): PrListSearch {
  return {
    repo: str(raw.repo),
    author: list(raw.author),
    status: list(raw.status)?.filter((s) => (PR_STATUSES as readonly string[]).includes(s)),
    label: list(raw.label),
    sort: oneOf(raw.sort, SORT_KEYS),
    dir: oneOf(raw.dir, SORT_DIRS),
  };
}

export const isEmptySearch = (s: object) => Object.values(s).every((v) => v === undefined || (Array.isArray(v) && v.length === 0));

// What the screens remember lives on the server (see view-memory.ts); only the values read back are
// checked here, since they come from outside.

export function loadPrFilters(repo: string): PrFilters {
  const { repo: _ignored, ...filters } = validatePrListSearch(prsMemory.filters(repo) ?? {});
  return filters;
}

export function savePrList(search: PrListSearch) {
  if (!search.repo) return;
  const { repo, ...filters } = search;
  prsMemory.remember(repo, filters);
}

/** What `/prs` with an empty query should restore to, or null when nothing was remembered. */
export function rememberedPrList(): PrListSearch | null {
  const repo = prsMemory.repo();
  if (!repo) return null;
  return { repo, ...loadPrFilters(repo) };
}

// ── Local branches ────────────────────────────────────────────────────────────

export interface LocalSearch {
  branch?: string;
  base?: string;
}

export const validateLocalSearch = (raw: Record<string, unknown>): LocalSearch => ({ branch: str(raw.branch), base: str(raw.base) });

export function loadLocalSelection(label: string): LocalSearch {
  return validateLocalSearch(localMemory.selection(label) ?? {});
}

export function saveLocalSelection(label: string, search: LocalSearch) {
  localMemory.remember(label, search);
}

export function rememberedLocalRepo(): string | null {
  return localMemory.label() ?? null;
}

/** A remembered repo that no longer exists must not keep redirecting `/local` to itself. */
export function forgetLocalRepo(label: string) {
  localMemory.forget(label);
}

// ── Local review identity ─────────────────────────────────────────────────────
// Local reviews are stored as repo `local/<label>-<hash>`; the path drops the `local/`
// prefix so it never needs a `%2F`.

export const reviewRepoSegment = (repo: string) => repo.replace(/^local\//, "");
export const reviewRepoFromSegment = (segment: string) => `local/${segment}`;

// ── Pager order ───────────────────────────────────────────────────────────────

export interface PrRef {
  repo: string;
  number: number;
}

const PR_ORDER = "prd:pr-order";

export function savePrOrder(order: PrRef[]) {
  writeStored("session", PR_ORDER, order);
}

export function loadPrOrder(): PrRef[] {
  const order = readStored<unknown>("session", PR_ORDER);
  return Array.isArray(order)
    ? order.filter((p): p is PrRef => !!p && typeof p.repo === "string" && typeof p.number === "number")
    : [];
}
