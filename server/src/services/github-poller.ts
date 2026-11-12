import { EventEmitter } from "node:events";
import { getDb } from "../db/schema";
import { configuredRepos } from "../routes/prs";
import { getViewer, listOpenPrHeads, listPrReviewComments, searchReviewRequested, type PrReviewComment } from "./github";
import { buildRepoState, deskCommentIdsByRepo, diffRepoState, type RepoWatchState, type WatchEvent } from "./github-watch";
import { getWatchSettings } from "./watch-settings";

/** Every GitHub event the poller detects, emitted as "event" (WatchEvent). */
export const githubEvents = new EventEmitter();
githubEvents.setMaxListeners(0);

// The last state seen per repository. A repository without one (server just started, repository just
// followed) is looked at silently first, so starting the Desk never fires a burst of old news.
const states = new Map<string, RepoWatchState>();

function plog(...args: unknown[]): void {
  console.log("[github-poller]", ...args);
}

function reviewedHeads(repo: string): Map<number, string> {
  const rows = getDb()
    .prepare("SELECT number, json_extract(snapshot, '$.headRefOid') AS head FROM reviews WHERE repo = ?")
    .all(repo) as { number: number; head: string | null }[];
  return new Map(rows.filter((r) => r.head).map((r) => [r.number, r.head as string]));
}

function deskCommentUrls(): string[] {
  const rows = getDb().prepare("SELECT comment_url FROM findings WHERE comment_url IS NOT NULL").all() as { comment_url: string }[];
  return rows.map((r) => r.comment_url);
}

const prNumberOf = (url: string) => Number(url.match(/\/pull\/(\d+)#/)?.[1]);

/** One look at every followed repository. Returns the events found (none on a repository's first look). */
export async function pollOnce(): Promise<WatchEvent[]> {
  const repos = configuredRepos();
  if (repos.length === 0) return [];

  const [viewer, requested] = await Promise.all([getViewer(), searchReviewRequested()]);
  const urls = deskCommentUrls();
  const deskIds = deskCommentIdsByRepo(urls);
  const events: WatchEvent[] = [];

  for (const repo of repos) {
    try {
      const openPrs = await listOpenPrHeads(repo);
      const ids = deskIds.get(repo) ?? new Set<number>();
      const openNumbers = new Set(openPrs.map((pr) => pr.number));
      const withDeskComments = [...new Set(urls.filter((u) => u.startsWith(`https://github.com/${repo}/pull/`)).map(prNumberOf))].filter((n) => openNumbers.has(n));
      const reviewComments = new Map<number, PrReviewComment[]>();
      for (const number of withDeskComments) reviewComments.set(number, await listPrReviewComments(repo, number));

      const after = buildRepoState({ repo, viewer, requested, openPrs, reviewedHeads: reviewedHeads(repo), deskCommentIds: ids, reviewComments });
      const found = diffRepoState(repo, states.get(repo), after);
      if (!states.has(repo)) plog(`${repo}: baseline (${after.requested.size} requested, ${after.moved.size} moved, ${after.replies.size} replies)`);
      states.set(repo, after);
      events.push(...found);
    } catch (err) {
      // Keep the previous state: the next poll compares against it and misses nothing.
      plog(`${repo}: poll failed, kept the previous state — ${(err as Error).message}`);
    }
  }

  for (const repo of states.keys()) if (!repos.includes(repo)) states.delete(repo);
  for (const event of events) githubEvents.emit("event", event);
  return events;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let polling: Promise<WatchEvent[]> | null = null;

/** Polls now unless a poll is already running, in which case it waits for that one. */
export function pollNow(): Promise<WatchEvent[]> {
  if (!polling) {
    polling = pollOnce()
      .catch((err) => {
        plog(`poll failed: ${(err as Error).message}`);
        return [];
      })
      .finally(() => {
        polling = null;
      });
  }
  return polling;
}

/** Polls GitHub every pollSeconds (read again each round, so a change applies at the next one). */
export function startGithubPoller(): void {
  if (timer) return;
  const loop = async () => {
    const events = await pollNow();
    if (events.length > 0) plog(`${events.length} event(s): ${events.map((e) => `${e.kind} ${e.repo}#${e.number}`).join(", ")}`);
    timer = setTimeout(loop, getWatchSettings(getDb()).pollSeconds * 1000);
  };
  timer = setTimeout(loop, 0);
}
