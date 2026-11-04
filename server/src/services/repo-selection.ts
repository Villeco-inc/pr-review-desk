import type Database from "better-sqlite3";
import { ALL_REPOS } from "../../../shared/types";

// The repositories the PR list shows. Picked in the app and kept in the database; until a pick
// is saved, REPOS from .env stands in for it, so an existing install keeps working unchanged.

const KEY = "selected_repos";
// The owner cannot start with a hyphen on GitHub, which also keeps the whole value from passing for an option;
// the name cannot be `.` or `..`, which would read as a path.
const REPO_NAME = /^[A-Za-z0-9][\w.-]*\/(?!\.{1,2}$)[\w.-]+$/;

/** Takes anything: a request body can carry a list or a number where a string is expected. */
export function isRepoName(repo: unknown): repo is string {
  return typeof repo === "string" && REPO_NAME.test(repo);
}

/** Drops a later spelling of a repository already listed: GitHub does not tell `Org/Repo` from `org/repo`. */
function uniqueRepos(repos: string[]): string[] {
  const seen = new Set<string>();
  return repos.filter((repo) => {
    const key = repo.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** REPOS from .env: the valid entries, once each, and the ones that were ignored. */
export function parseRepoList(raw: string | undefined): { repos: string[]; ignored: string[] } {
  const entries = (raw ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return { repos: uniqueRepos(entries.filter(isRepoName)), ignored: entries.filter((r) => !isRepoName(r)) };
}

function savedRepos(db: Database.Database): string[] | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string[]) : null;
}

export function selectedRepos(db: Database.Database, envRepos: string | undefined): string[] {
  // A selection saved under an older rule is cleaned the same way as REPOS, so no invalid value reaches gh.
  const saved = savedRepos(db);
  return saved ? uniqueRepos(saved.filter(isRepoName)) : parseRepoList(envRepos).repos;
}

/** The repositories a `repo` request stands for: the whole selection for "all", itself when selected, null for anything else. */
export function scopeOf(repo: string, selected: string[]): string[] | null {
  if (repo === ALL_REPOS) return selected;
  const found = selected.find((r) => r.toLowerCase() === repo.toLowerCase());
  return found === undefined ? null : [found];
}

/** A single selected repository, under the spelling of the selection; null for anything else, "all" included. */
export function selectedRepoNamed(repo: string, selected: string[]): string | null {
  if (repo === ALL_REPOS) return null;
  return scopeOf(repo, selected)?.[0] ?? null;
}

/** Saves the pick and returns the repositories it added to the one saved before. */
export function saveSelectedRepos(db: Database.Database, repos: string[]): string[] {
  if (repos.length === 0) throw new Error("Pick at least one repository");
  const invalid = repos.find((r) => !isRepoName(r));
  if (invalid !== undefined) throw new Error(`Not a repository: ${invalid}`);
  const before = new Set((savedRepos(db) ?? []).map((r) => r.toLowerCase()));
  const picked = uniqueRepos(repos);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    KEY,
    JSON.stringify(picked)
  );
  return picked.filter((r) => !before.has(r.toLowerCase()));
}
