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

export function selectedRepos(db: Database.Database, envRepos: string | undefined): string[] {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string[]) : parseRepoList(envRepos);
}

export function saveSelectedRepos(db: Database.Database, repos: string[]): void {
  if (repos.length === 0) throw new Error("Pick at least one repository");
  const invalid = repos.find((r) => !REPO_NAME.test(r));
  if (invalid !== undefined) throw new Error(`Not a repository: ${invalid}`);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    KEY,
    JSON.stringify([...new Set(repos)])
  );
}
