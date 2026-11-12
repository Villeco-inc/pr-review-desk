import type { OpenPrHead, PrReviewComment, ReviewRequestedPr } from "./github";

// Pure detection for the GitHub poller: one poll becomes a RepoWatchState, and two states in a row
// become the events between them. No state before means the first look at a repository: nothing is new.

export interface RepoWatchState {
  /** Open PRs asking for the viewer's review, by number. */
  requested: Map<number, ReviewRequestedPr>;
  /** PRs the Desk reviewed whose head is no longer the reviewed commit, by number. */
  moved: Map<number, { title: string; url: string; head: string; reviewedHead: string }>;
  /** Replies by someone else under a comment the Desk posted, by comment id. */
  replies: Map<number, { number: number; title: string; author: string; body: string; url: string }>;
}

export interface RepoWatchInput {
  repo: string;
  viewer: string;
  /** Review requests, across repositories: only this repository's are kept. */
  requested: ReviewRequestedPr[];
  openPrs: OpenPrHead[];
  /** The commit each Desk review of this repository read, by PR number. */
  reviewedHeads: Map<number, string>;
  /** Comment ids the Desk posted on this repository's PRs. */
  deskCommentIds: Set<number>;
  /** Inline comments of the open PRs carrying a Desk comment, by PR number. */
  reviewComments: Map<number, PrReviewComment[]>;
}

export type WatchEvent =
  | { kind: "review-requested"; repo: string; number: number; title: string; url: string; author: string }
  | { kind: "new-commits"; repo: string; number: number; title: string; url: string; head: string; reviewedHead: string }
  | { kind: "comment-reply"; repo: string; number: number; title: string; url: string; author: string; body: string; commentId: number };

/** The comment ids in Desk comment URLs (`…/pull/12#discussion_r123`), keyed by repo. Issue comments have no thread to reply in. */
export function deskCommentIdsByRepo(urls: string[]): Map<string, Set<number>> {
  const byRepo = new Map<string, Set<number>>();
  for (const url of urls) {
    const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+#discussion_r(\d+)$/);
    if (!m) continue;
    const ids = byRepo.get(m[1]) ?? new Set<number>();
    ids.add(Number(m[2]));
    byRepo.set(m[1], ids);
  }
  return byRepo;
}

export function buildRepoState(input: RepoWatchInput): RepoWatchState {
  const requested = new Map(input.requested.filter((pr) => pr.repo === input.repo).map((pr) => [pr.number, pr]));

  const moved: RepoWatchState["moved"] = new Map();
  for (const pr of input.openPrs) {
    const reviewedHead = input.reviewedHeads.get(pr.number);
    if (reviewedHead && pr.headRefOid && pr.headRefOid !== reviewedHead) {
      moved.set(pr.number, { title: pr.title, url: pr.url, head: pr.headRefOid, reviewedHead });
    }
  }

  const titles = new Map(input.openPrs.map((pr) => [pr.number, pr.title]));
  const viewer = input.viewer.toLowerCase();
  const replies: RepoWatchState["replies"] = new Map();
  for (const [number, comments] of input.reviewComments) {
    for (const c of comments) {
      if (c.inReplyToId === null || !input.deskCommentIds.has(c.inReplyToId)) continue;
      if (c.isBot || c.author.toLowerCase() === viewer) continue;
      replies.set(c.id, { number, title: titles.get(number) ?? "", author: c.author, body: c.body, url: c.url });
    }
  }

  return { requested, moved, replies };
}

/** What appeared between two polls of one repository. A request, a head or a reply seen before is not news again. */
export function diffRepoState(repo: string, before: RepoWatchState | undefined, after: RepoWatchState): WatchEvent[] {
  if (!before) return [];
  const events: WatchEvent[] = [];

  for (const [number, pr] of after.requested) {
    if (!before.requested.has(number)) events.push({ kind: "review-requested", repo, number, title: pr.title, url: pr.url, author: pr.author });
  }
  for (const [number, pr] of after.moved) {
    if (before.moved.get(number)?.head !== pr.head) {
      events.push({ kind: "new-commits", repo, number, title: pr.title, url: pr.url, head: pr.head, reviewedHead: pr.reviewedHead });
    }
  }
  for (const [commentId, reply] of after.replies) {
    if (!before.replies.has(commentId)) events.push({ kind: "comment-reply", repo, commentId, ...reply });
  }

  return events;
}
