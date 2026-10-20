import type Database from "better-sqlite3";
import type { Freshness, PullRequest } from "../../../shared/types";

export interface PrRefresherDeps {
  db: Database.Database;
  fetchPrs: (repo: string) => Promise<PullRequest[]>;
  selected: () => string[];
  now?: () => number;
}

const ACTIVE_WINDOW_MS = 10 * 60_000;

export function createPrRefresher({ db, fetchPrs, selected, now = Date.now }: PrRefresherDeps) {
  const errors = new Map<string, string>();

  function cached(repo: string): PullRequest[] | null {
    const row = db.prepare("SELECT prs FROM pr_cache WHERE repo = ?").get(repo) as { prs: string } | undefined;
    return row ? (JSON.parse(row.prs) as PullRequest[]) : null;
  }

  // One writer per cache row: a refresh asked while another runs for the same repository joins it.
  const inFlight = new Map<string, Promise<void>>();

  function refreshRepo(repo: string): Promise<void> {
    const running = inFlight.get(repo);
    if (running) return running;
    const started = fetchAndStore(repo).finally(() => inFlight.delete(repo));
    inFlight.set(repo, started);
    return started;
  }

  async function fetchAndStore(repo: string): Promise<void> {
    let prs: PullRequest[];
    try {
      prs = await fetchPrs(repo);
    } catch (err) {
      errors.set(repo, err instanceof Error ? err.message : String(err));
      throw err;
    }
    db.prepare(
      `INSERT INTO pr_cache (repo, prs, fetched_at) VALUES (@repo, @prs, @fetched_at)
       ON CONFLICT(repo) DO UPDATE SET prs = excluded.prs, fetched_at = excluded.fetched_at`
    ).run({ repo, prs: JSON.stringify(prs), fetched_at: new Date(now()).toISOString() });
    errors.delete(repo);
  }

  // A read asks GitHub only for what was never cached and has not just failed; the tick and a forced refresh retry the rest.
  async function list(repos: string[], force = false): Promise<PullRequest[]> {
    const wanted = repos.filter((repo) => force || (!cached(repo) && !errors.has(repo)));
    await Promise.allSettled(wanted.map(refreshRepo));
    const lists = repos.map((repo) => cached(repo));
    const error = repos.map((repo) => errors.get(repo)).find((e) => e !== undefined);
    // A failure is thrown when a refresh was asked for or when it leaves nothing to show; otherwise freshness() carries it.
    if (error !== undefined && (force || lists.every((l) => l === null))) throw new Error(error);
    return lists.flatMap((l) => l ?? []);
  }

  /** Refreshes the given repositories, the selected ones by default; a failure is kept for freshness(), never thrown. */
  async function warm(repos: string[] = selected()): Promise<void> {
    await Promise.allSettled(repos.map(refreshRepo));
  }

  function freshness(repos: string[]): Freshness {
    const fetchedAt = repos.map((repo) => {
      const row = db.prepare("SELECT fetched_at FROM pr_cache WHERE repo = ?").get(repo) as { fetched_at: string } | undefined;
      return row?.fetched_at ?? null;
    });
    return {
      fetchedAt: repos.length === 0 || fetchedAt.includes(null) ? null : (fetchedAt as string[]).reduce((a, b) => (a < b ? a : b)),
      error: repos.map((repo) => errors.get(repo)).find((e) => e !== undefined) ?? null,
      version: fetchedAt.map((f) => f ?? "").join("|"),
    };
  }

  // Nobody looking means nobody to refresh for: GitHub is only asked while a client was seen lately.
  let lastSeen: number | null = null;

  function touch(): void {
    lastSeen = now();
  }

  async function tick(): Promise<void> {
    if (lastSeen === null || now() - lastSeen >= ACTIVE_WINDOW_MS) return;
    await warm();
  }

  return { list, warm, freshness, tick, touch };
}
