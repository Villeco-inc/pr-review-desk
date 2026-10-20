import type Database from "better-sqlite3";

// The repositories the PR list shows. Picked in the app and kept in the database; until a pick
// is saved, REPOS from .env stands in for it, so an existing install keeps working unchanged.

const KEY = "selected_repos";
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

function parseRepoList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function savedRepos(db: Database.Database): string[] | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string[]) : null;
}

export function selectedRepos(db: Database.Database, envRepos: string | undefined): string[] {
  return savedRepos(db) ?? parseRepoList(envRepos);
}

/** Saves the pick and returns the repositories it added to the one saved before. */
export function saveSelectedRepos(db: Database.Database, repos: string[]): string[] {
  if (repos.length === 0) throw new Error("Pick at least one repository");
  const invalid = repos.find((r) => !REPO_NAME.test(r));
  if (invalid !== undefined) throw new Error(`Not a repository: ${invalid}`);
  const before = new Set(savedRepos(db));
  const picked = [...new Set(repos)];
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    KEY,
    JSON.stringify(picked)
  );
  return picked.filter((r) => !before.has(r));
}
