import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Freshness, PullRequest } from "../../../shared/types";

export interface PrRefresherDeps {
  db: Database.Database;
  fetchPrs: (repo: string) => Promise<PullRequest[]>;
  selected: () => string[];
  now?: () => number;
  /** Delay before the next refresh, read again at every cycle so it can change while the server runs. */
  refreshEveryMs?: () => number;
  /** How long after a client was last seen the refreshes go on, read again at every tick. */
  activeWindowMs?: () => number;
  /** Delay between refreshes while nobody is looking, read again at every tick. */
  idleRefreshEveryMs?: () => number;
}

const REFRESH_EVERY_MS = 90_000;
const ACTIVE_WINDOW_MS = 10 * 60_000;
const IDLE_REFRESH_EVERY_MS = 30 * 60_000;

// GitHub gives 5000 GraphQL points an hour. Refreshing one repository is taken to cost 2 (not measured), and
// refreshing while nobody looks may use a quarter of the hour, which leaves the rest to people and to reviews.
const GITHUB_POINTS_PER_HOUR = 5000;
const POINTS_PER_REPO_REFRESH = 2;
const IDLE_BUDGET_SHARE = 0.25;
const minIdleRefreshEveryMs = (repoCount: number) =>
  Math.ceil((repoCount * POINTS_PER_REPO_REFRESH * 3_600_000) / (GITHUB_POINTS_PER_HOUR * IDLE_BUDGET_SHARE));

/** A setting that cannot be read, or is not a positive number, falls back to its default instead of breaking the schedule. */
function read(setting: () => number, fallback: number): number {
  try {
    const value = setting();
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // an unusable setting takes the default
  }
  return fallback;
}

export function createPrRefresher({
  db,
  fetchPrs,
  selected,
  now = Date.now,
  refreshEveryMs = () => REFRESH_EVERY_MS,
  activeWindowMs = () => ACTIVE_WINDOW_MS,
  idleRefreshEveryMs = () => IDLE_REFRESH_EVERY_MS,
}: PrRefresherDeps) {
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
    try {
      db.prepare(
        `INSERT INTO pr_cache (repo, prs, fetched_at) VALUES (@repo, @prs, @fetched_at)
         ON CONFLICT(repo) DO UPDATE SET prs = excluded.prs, fetched_at = excluded.fetched_at`
      ).run({ repo, prs: JSON.stringify(prs), fetched_at: new Date(now()).toISOString() });
    } catch (err) {
      if (!errors.has(repo)) errors.set(repo, err instanceof Error ? err.message : String(err));
      throw err;
    }
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
  async function warm(repos?: string[]): Promise<void> {
    if (!repos) lastWarm = now(); // only a refresh of every selected repository tells when the next slow one is due
    try {
      await Promise.allSettled((repos ?? selected()).map(refreshRepo));
    } catch (err) {
      console.error("[refresh] the selected repositories could not be read:", err);
    }
  }

  // What the list shows about reviews comes from the database, not from GitHub: a review starting, ending or
  // failing, or a finding being posted, must change the version too. The status counts as well, because the
  // restart that fails stuck reviews does not touch updated_at.
  function reviewsFingerprint(repos: string[]): string {
    if (repos.length === 0) return "";
    const rows = db
      .prepare(
        `SELECT r.id, r.status, r.updated_at,
                (SELECT count(*) FROM findings f WHERE f.review_id = r.id AND f.state = 'open') AS open,
                (SELECT count(*) FROM findings f WHERE f.review_id = r.id AND f.state = 'posted') AS posted
           FROM reviews r WHERE r.repo IN (${repos.map(() => "?").join(",")}) ORDER BY r.id`
      )
      .all(...repos);
    return createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 12);
  }

  function freshness(repos: string[]): Freshness {
    const fetchedAt = repos.map((repo) => {
      const row = db.prepare("SELECT fetched_at FROM pr_cache WHERE repo = ?").get(repo) as { fetched_at: string } | undefined;
      return row?.fetched_at ?? null;
    });
    return {
      fetchedAt: repos.length === 0 || fetchedAt.includes(null) ? null : (fetchedAt as string[]).reduce((a, b) => (a < b ? a : b)),
      error: repos.map((repo) => errors.get(repo)).find((e) => e !== undefined) ?? null,
      version: `${fetchedAt.map((f) => f ?? "").join("|")}#${reviewsFingerprint(repos)}`,
      refreshing: repos.some((repo) => inFlight.has(repo)),
      activeEveryMs: read(refreshEveryMs, REFRESH_EVERY_MS),
    };
  }

  // Nobody looking means nobody to refresh for: GitHub is only asked while a client was seen lately.
  let lastSeen: number | null = null;

  // A client back after the quiet period gets fresh data at once instead of waiting for the next tick.
  // The very first visit does not count: the refresh at startup already covers it.
  function touch(): void {
    const wasQuiet = lastSeen !== null && now() - lastSeen >= read(activeWindowMs, ACTIVE_WINDOW_MS);
    lastSeen = now();
    if (wasQuiet) void warm();
  }

  // Nobody looking does not mean never refreshing: a slow refresh keeps the data from being hours old when someone comes back.
  let lastWarm: number | null = null;

  function idleRefreshDue(): boolean {
    if (lastWarm === null) return false;
    let repoCount = 0;
    try {
      repoCount = selected().length;
    } catch {
      // an unreadable selection leaves only the delay itself
    }
    return now() - lastWarm >= Math.max(read(idleRefreshEveryMs, IDLE_REFRESH_EVERY_MS), minIdleRefreshEveryMs(repoCount));
  }

  async function tick(): Promise<void> {
    const watched = lastSeen !== null && now() - lastSeen < read(activeWindowMs, ACTIVE_WINDOW_MS);
    if (watched || idleRefreshDue()) await warm();
  }

  /** Refreshes now, then again after each delay, until the returned function is called. */
  function start(): () => void {
    void warm();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => void tick().then(() => !stopped && schedule()), read(refreshEveryMs, REFRESH_EVERY_MS));
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  return { list, warm, freshness, tick, touch, start };
}
