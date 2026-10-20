import type Database from "better-sqlite3";
import { ALL_REPOS } from "../../../shared/types";
import { scopeOf } from "./repo-selection";

// What each screen remembers between visits: the last repository of the pull request list with that
// repository's own filters, and the last local repository with its branch pair. One settings row.

type Fields = Record<string, unknown>;

export interface ViewMemory {
  prs: { repo: string | null; filters: Record<string, Fields> };
  local: { label: string | null; selection: Record<string, Fields> };
}

const KEY = "view_memory";

const empty = (): ViewMemory => ({ prs: { repo: null, filters: {} }, local: { label: null, selection: {} } });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What is stored comes from the browser: take the known shape and nothing else, so a damaged row reads as empty. */
function normalize(raw: unknown): ViewMemory {
  const memory = empty();
  if (!isObject(raw)) return memory;
  if (isObject(raw.prs)) {
    if (typeof raw.prs.repo === "string") memory.prs.repo = raw.prs.repo;
    if (isObject(raw.prs.filters)) for (const [repo, filters] of Object.entries(raw.prs.filters)) memory.prs.filters[repo] = sanitizeFilters(filters);
  }
  if (isObject(raw.local)) {
    if (typeof raw.local.label === "string") memory.local.label = raw.local.label;
    if (isObject(raw.local.selection)) {
      for (const [label, selection] of Object.entries(raw.local.selection)) {
        if (isLabel(label)) memory.local.selection[label] = sanitizeSelection(selection);
      }
    }
  }
  return memory;
}

function load(db: Database.Database): ViewMemory {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return empty();
  try {
    return normalize(JSON.parse(row.value));
  } catch {
    return empty();
  }
}

function save(db: Database.Database, memory: ViewMemory): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    KEY,
    JSON.stringify(memory)
  );
}

// A local repository is named by a label from LOCAL_REPOS, written freely by the user: accents and spaces
// are fine. Only what could not be a key is refused: nothing, something very long, control characters, `__proto__`.
const isLabel = (label: string) => label.length >= 1 && label.length <= 80 && label !== "__proto__" && !/[\u0000-\u001f]/.test(label);
const MAX_LOCAL_REPOS = 100;

/** A local selection is a branch and a base: short strings, nothing else. */
function sanitizeSelection(raw: unknown): Fields {
  if (!isObject(raw)) return {};
  const selection: Fields = {};
  for (const key of ["branch", "base"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length <= 300) selection[key] = value;
  }
  return selection;
}

const LIST_KEYS = ["author", "status", "label"];
const WORD_KEYS = ["sort", "dir"];

/** A list filter holds a bounded list of short strings, a sort a short word; the screen checks the values themselves. */
function sanitizeFilters(raw: unknown): Fields {
  if (!isObject(raw)) return {};
  const filters: Fields = {};
  for (const key of LIST_KEYS) {
    const value = raw[key];
    if (Array.isArray(value)) filters[key] = value.filter((v): v is string => typeof v === "string" && v.length <= 200).slice(0, 100);
  }
  for (const key of WORD_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.length <= 20) filters[key] = value;
  }
  return filters;
}

/** Remembers the branch pair of a local repository, and that it was the last one looked at. */
export function rememberLocalSelection(db: Database.Database, label: string, selection: unknown): void {
  if (!isLabel(label)) throw new Error("not a local repository label");
  const memory = load(db);
  if (!Object.hasOwn(memory.local.selection, label) && Object.keys(memory.local.selection).length >= MAX_LOCAL_REPOS) {
    throw new Error("too many local repositories remembered");
  }
  memory.local.label = label;
  memory.local.selection[label] = sanitizeSelection(selection);
  save(db, memory);
}

export function forgetLocalSelection(db: Database.Database, label: string): void {
  const memory = load(db);
  delete memory.local.selection[label];
  if (memory.local.label === label) memory.local.label = null;
  save(db, memory);
}

/** The memory as it can be used now: repositories that left the selection are not served. */
export function readViewMemory(db: Database.Database, selected: string[]): ViewMemory {
  const memory = load(db);
  const filters: Record<string, Fields> = {};
  for (const [repo, value] of Object.entries(memory.prs.filters)) {
    const scope = scopeOf(repo, selected);
    if (scope) filters[repo === ALL_REPOS ? ALL_REPOS : scope[0]] = value;
  }
  const repo = memory.prs.repo !== null && scopeOf(memory.prs.repo, selected) ? memory.prs.repo : null;
  return { prs: { repo, filters }, local: memory.local };
}

/** Remembers the repository the list shows and its filters; only "all" or a selected repository is accepted. */
export function rememberPrView(db: Database.Database, selected: string[], repo: string, filters: unknown): void {
  const scope = scopeOf(repo, selected);
  if (!scope) throw new Error(`${repo} is not a selected repository`);
  const key = repo === ALL_REPOS ? ALL_REPOS : scope[0];
  const memory = load(db);
  memory.prs.repo = key;
  memory.prs.filters[key] = sanitizeFilters(filters);
  save(db, memory);
}
