import { Router } from "express";
import { getDb } from "../db/schema";
import { listPullRequests, listOrgPullRequests, listAccessibleRepos, fetchPrSnapshot, getViewer } from "../services/github";
import { saveSelectedRepos, selectedRepos } from "../services/repo-selection";
import { reviewId } from "../services/review-engine";
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
  res.json(configuredRepos());
});

prsRouter.put("/repos", (req, res) => {
  const { repos } = req.body as { repos?: unknown };
  if (!Array.isArray(repos) || !repos.every((r) => typeof r === "string")) {
    res.status(400).json({ error: "repos must be a list of owner/name" });
    return;
  }
  try {
    saveSelectedRepos(getDb(), repos);
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
  const repo = String(req.query.repo ?? "");
  if (!repo) {
    res.status(400).json({ error: "repo query param is required" });
    return;
  }

  const force = req.query.refresh === "true";

  try {
    const prs = repo.startsWith("org:") ? await listOrgPullRequests(repo.slice(4), force) : await listPullRequests(repo, force);
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
