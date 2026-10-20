import { Router } from "express";
import { getDb } from "../db/schema";
import { fetchPullRequests, listAccessibleRepos, fetchPrSnapshot, getViewer } from "../services/github";
import { createPrRefresher } from "../services/pr-refresh";
import { saveSelectedRepos, selectedRepos } from "../services/repo-selection";
import { reviewId } from "../services/review-engine";
import { ALL_REPOS } from "../../../shared/types";
import type { FindingRow, MyReviewState, PullRequest, PullRequestDto, ReviewRow } from "../../../shared/types";

export const prsRouter = Router();

const refresher = createPrRefresher({
  db: getDb(),
  fetchPrs: fetchPullRequests,
  selected: () => selectedRepos(getDb(), process.env.REPOS),
});

const REFRESH_EVERY_MS = 90_000;

/** Warms the cache now, then keeps it fresh while a client is looking. */
export function startPrRefresh(): void {
  void refresher.warm();
  setInterval(() => void refresher.tick(), REFRESH_EVERY_MS);
}

const reposOf = (repo: string) => (repo === ALL_REPOS ? selectedRepos(getDb(), process.env.REPOS) : [repo]);

function reviewStatusFor(repo: string, number: number): ReviewRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(reviewId(repo, number)) as ReviewRow | undefined;
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
  res.json(selectedRepos(getDb(), process.env.REPOS));
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
    res.json(selectedRepos(getDb(), process.env.REPOS));
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
  const repo = String(req.query.repo ?? "");
  if (!repo) {
    res.status(400).json({ error: "repo query param is required" });
    return;
  }

  refresher.touch();

  try {
    const prs = await refresher.list(reposOf(repo));
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
  const repo = String(req.query.repo ?? "");
  if (!repo) {
    res.status(400).json({ error: "repo query param is required" });
    return;
  }
  refresher.touch();
  try {
    await refresher.list(reposOf(repo), true);
    res.json(refresher.freshness(reposOf(repo)));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

prsRouter.get("/freshness", (req, res) => {
  const repo = String(req.query.repo ?? "");
  if (!repo) {
    res.status(400).json({ error: "repo query param is required" });
    return;
  }
  refresher.touch();
  res.json(refresher.freshness(reposOf(repo)));
});

prsRouter.get("/prs/:owner/:name/:number", async (req, res) => {
  const repo = `${req.params.owner}/${req.params.name}`;
  const num = Number(req.params.number);
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
