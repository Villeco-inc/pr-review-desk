// What the tests read and set in the running world: the database, the fake CLIs' journals,
// and the hold on the fake claude. The server re-reads the database on every request, so a
// test can reset it between flows without restarting anything. node:sqlite, not better-sqlite3:
// the runner loads each test file in a fresh realm of the same worker, and a native addon loaded
// twice in one process aborts it.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_URL, WORLD } from "./world";

export interface GhWrite {
  endpoint: string;
  method: string;
  fields: Record<string, string | number | boolean>;
}

export interface FindingRow {
  id: string;
  title: string;
  state: string;
  draft_comment: string | null;
  comment_url: string | null;
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(WORLD, "data/reviews.db"), { timeout: 5_000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function readJsonl<T>(file: string): T[] {
  const text = fs.existsSync(path.join(WORLD, file)) ? fs.readFileSync(path.join(WORLD, file), "utf8") : "";
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/**
 * Back to a first launch: no review, no finding, no cached PR list, no repository picked,
 * empty journals. With `repos`, those repositories are already picked.
 */
export function resetWorld({ repos }: { repos?: string[] } = {}): void {
  withDb((db) => {
    db.exec("BEGIN; DELETE FROM findings; DELETE FROM review_runs; DELETE FROM reviews; DELETE FROM pr_cache; DELETE FROM settings; DELETE FROM notifications;");
    if (repos) db.prepare("INSERT INTO settings (key, value) VALUES ('selected_repos', ?)").run(JSON.stringify(repos));
    db.exec("COMMIT");
  });
  for (const journal of ["gh-calls.jsonl", "gh-writes.jsonl", "gh-failures.jsonl", "claude-calls.jsonl"]) fs.writeFileSync(path.join(WORLD, journal), "");
  releaseClaude();
}

/** What the Desk sent to GitHub: every POST the fake gh received, in order, without its timestamp. */
export const ghWrites = (): GhWrite[] => readJsonl<GhWrite & { at: string }>("gh-writes.jsonl").map(({ at: _at, ...write }) => write);

/** Every command the fake gh received, reads included, as its argument list. */
export const ghCalls = (): string[][] => readJsonl<{ args: string[] }>("gh-calls.jsonl").map((c) => c.args);

/** The commands the fake gh did not know and refused: a flow that reaches one is outside the closed world. */
export const ghFailures = () => readJsonl<{ args: string[]; message: string }>("gh-failures.jsonl");

/** Every run of the fake claude, in order, with the prompt it was sent. */
export const claudeCalls = () => readJsonl<{ pid: number; args: string[]; prompt: string; report: string }>("claude-calls.jsonl");

/** Whether a process still runs: signal 0 only checks that it exists. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the next reviews running until releaseClaude(). */
export const holdClaude = () => fs.writeFileSync(path.join(WORLD, "claude-hold"), "");
export const releaseClaude = () => fs.rmSync(path.join(WORLD, "claude-hold"), { force: true });

export const selectedRepos = (): string[] | null =>
  withDb((db) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'selected_repos'").get() as unknown as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as string[]) : null;
  });

export const reviewStatus = (id: string): string | null =>
  withDb((db) => (db.prepare("SELECT status FROM reviews WHERE id = ?").get(id) as unknown as { status: string } | undefined)?.status ?? null);

export const reviewsLike = (pattern: string): { id: string; status: string }[] =>
  withDb((db) => db.prepare("SELECT id, status FROM reviews WHERE id LIKE ?").all(pattern) as unknown as { id: string; status: string }[]);

export const runStatuses = (reviewId: string): string[] =>
  withDb((db) => (db.prepare("SELECT status FROM review_runs WHERE review_id = ? ORDER BY started_at").all(reviewId) as unknown as { status: string }[]).map((r) => r.status));

export const notificationKinds = (): string[] =>
  withDb((db) => (db.prepare("SELECT kind FROM notifications ORDER BY id").all() as unknown as { kind: string }[]).map((r) => r.kind));

export const findingByTitle = (title: string): FindingRow | undefined =>
  withDb((db) => db.prepare("SELECT id, title, state, draft_comment, comment_url FROM findings WHERE title = ?").get(title) as unknown as FindingRow | undefined);

/** A call to the Desk's API as its own page makes it (same Origin, so writes are accepted). */
export async function api<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP_URL}${route}`, {
    method,
    headers: { "content-type": "application/json", origin: APP_URL },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * A finished review of a pull request, made through the API as the page would (same Origin),
 * for the flows that start from findings rather than from the review itself.
 */
export async function seedReview(repo: string, number: number): Promise<void> {
  await api("POST", "/api/reviews", { repo, number });
  const id = `${repo}#${number}`;
  const deadline = Date.now() + 15_000;
  while (reviewStatus(id) !== "reported") {
    if (Date.now() > deadline) throw new Error(`seedReview: ${id} is ${reviewStatus(id)}, not reported`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
