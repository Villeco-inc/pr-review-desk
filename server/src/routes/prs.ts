import { Router, type Request, type Response } from "express";
import { getDb } from "../db/schema";
import { fetchPullRequests, listAccessibleRepos, fetchPrSnapshot, getViewer } from "../services/github";
import { createPrRefresher } from "../services/pr-refresh";
import { isRepoName, saveSelectedRepos, scopeOf, selectedRepos } from "../services/repo-selection";
import { findReview } from "../services/review-lookup";
import { discoveredRepos } from "../services/repo-discovery";
import { checkoutsRoot } from "../services/local-git";
import type { FindingRow, MyReviewState, PullRequest, PullRequestDto, ReviewRow } from "../../../shared/types";

export const prsRouter = Router();

/**
 * The GitHub repos the PR list and Compare offer: the pick saved in the app. Until one is saved,
 * REPOS plus the GitHub repo of every checkout found under SCAN_DIR stand in for it.
 */
export function configuredRepos(): string[] {
  const found = discoveredRepos(checkoutsRoot())
    .map((r) => r.ghRepo)
    .filter((r): r is string => !!r);
  const startingPick = [...new Set([...(process.env.REPOS ?? "").split(","), ...found].map((r) => r.trim()).filter(Boolean))];
  return selectedRepos(getDb(), startingPick.join(","));
}

const refresher = createPrRefresher({
  db: getDb(),
  fetchPrs: fetchPullRequests,
  selected: configuredRepos,
});

/** Warms the cache now, then keeps it fresh while a client is looking. */
export function startPrRefresh(): void {
  refresher.start();
}

/** The repositories the request's `repo` stands for, or null once a 400 has been sent: only selected ones are served. */
function scopeFor(req: Request, res: Response): string[] | null {
  const repo = String(req.query.repo ?? "");
  if (!repo) {
    res.status(400).json({ error: "repo query param is required" });
    return null;
  }
  const scope = scopeOf(repo, configuredRepos());
  if (!scope) res.status(400).json({ error: `${repo} is not a selected repository` });
  return scope;
}

function reviewStatusFor(repo: string, number: number): ReviewRow | undefined {
  return findReview(getDb(), repo, number);
}

function findingCounts(id: string): { open: number; posted: number } {
  const db = getDb();
  const rows = db.prepare("SELECT state FROM findings WHERE review_id = ?").all(id) as FindingRow[];
  return {
    open: rows.filter((r) => r.state === "open").length,
    posted: rows.filter((r) => r.state === "posted").length,
  };
}

function myReviewFor(pr: PullRequest, viewer: string | null): MyReviewState | null {
  if (!viewer) return null;
  const state = pr.latestReviews?.find((r) => r.author.toLowerCase() === viewer.toLowerCase())?.state;
  return state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "COMMENTED" ? state : null;
}

prsRouter.get("/repos", (_req, res) => {
  res.json(configuredRepos());
});

prsRouter.put("/repos", (req, res) => {
  const { repos } = req.body as { repos?: unknown };
  if (!Array.isArray(repos) || !repos.every((r) => typeof r === "string")) {
    res.status(400).json({ error: "repos must be a list of owner/name" });
    return;
  }
  try {
    const added = saveSelectedRepos(getDb(), repos);
    void refresher.warm(added);
    res.json(configuredRepos());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

prsRouter.get("/repos/available", async (_req, res) => {
  try {
    res.json(await listAccessibleRepos());
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

prsRouter.get("/viewer", async (_req, res) => {
  try {
    const login = await getViewer();
    res.json({ login });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

prsRouter.get("/prs", async (req, res) => {
  const scope = scopeFor(req, res);
  if (!scope) return;

  refresher.touch();

  try {
    const prs = await refresher.list(scope);
    // The list still loads if the viewer lookup fails; the column just stays empty.
    const viewer = await getViewer().catch(() => null);
    const dtos: PullRequestDto[] = prs.map((pr) => {
      const review = reviewStatusFor(pr.repo, pr.number);
      const counts = review ? findingCounts(review.id) : { open: 0, posted: 0 };
      return {
        ...pr,
        reviewStatus: (review?.status as PullRequestDto["reviewStatus"]) ?? "none",
        myReview: myReviewFor(pr, viewer),
        openFindings: counts.open,
        postedFindings: counts.posted,
      };
    });
    res.json(dtos);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Asks GitHub now instead of waiting for the next refresh; the list is read again with GET /prs. */
prsRouter.post("/refresh", async (req, res) => {
  const scope = scopeFor(req, res);
  if (!scope) return;
  refresher.touch();
  try {
    await refresher.list(scope, true);
    res.json(refresher.freshness(scope));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

prsRouter.get("/freshness", (req, res) => {
  const scope = scopeFor(req, res);
  if (!scope) return;
  refresher.touch();
  res.json(refresher.freshness(scope));
});

prsRouter.get("/prs/:owner/:name/:number", async (req, res) => {
  const repo = `${req.params.owner}/${req.params.name}`;
  const num = Number(req.params.number);
  if (!isRepoName(repo)) {
    res.status(400).json({ error: "repo must be owner/name" });
    return;
  }
  if (!Number.isFinite(num)) {
    res.status(400).json({ error: "invalid PR number" });
    return;
  }

  try {
    const snapshot = await fetchPrSnapshot(repo, num);
    const review = reviewStatusFor(repo, num);
    const db = getDb();
    const findings = review
      ? (db.prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY ord ASC").all(review.id) as FindingRow[])
      : [];

    res.json({ snapshot, review: review ?? null, findings });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
