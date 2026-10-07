import { Router } from "express";
import { getDb } from "../db/schema";
import { configuredLocalRepos, listLocalBranches, defaultBaseBranch, localRepoIdentity, getLocalDiff } from "../services/local-git";
import { startLocalReview, reviewId } from "../services/review-engine";
import { splitUnifiedDiff } from "../services/diff-utils";
import { toFindingDto, toReviewDto } from "../services/dto";
import type { FindingRow, ReviewRow } from "../../../shared/types";

export const localRouter = Router();

function loadReview(id: string): ReviewRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
}

function loadFindings(id: string): FindingRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY ord ASC").all(id) as FindingRow[];
}

localRouter.get("/local/repos", (_req, res) => {
  res.json(configuredLocalRepos());
});

localRouter.get("/local/branches", async (req, res) => {
  const label = String(req.query.repo ?? "");
  const repo = configuredLocalRepos().find((r) => r.label === label);
  if (!repo) {
    res.status(400).json({ error: "unknown local repo" });
    return;
  }

  try {
    const [branches, base] = await Promise.all([listLocalBranches(repo.path), defaultBaseBranch(repo.path)]);
    res.json({ branches, defaultBase: base });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** What a review of this branch would read, so the screen can say it before a run is spent. */
localRouter.get("/local/diff-summary", async (req, res) => {
  const repo = configuredLocalRepos().find((r) => r.label === String(req.query.repo ?? ""));
  const branch = String(req.query.branch ?? "");
  const base = String(req.query.base ?? "");
  if (!repo || !branch || !base) {
    res.status(400).json({ error: "repo, branch and base are required" });
    return;
  }
  try {
    const { files, baseRef, ownCommits, worktree, uncommittedFiles } = await getLocalDiff(repo.path, branch, base);
    res.json({ baseRef, ownCommits, uncommittedFiles, worktree, files: files.length });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

localRouter.post("/local/reviews", async (req, res) => {
  const { repo: label, branch, base, skills, model, effort } = req.body as {
    repo?: string;
    branch?: string;
    base?: string;
    skills?: string[];
    model?: string;
    effort?: string;
  };

  const repo = configuredLocalRepos().find((r) => r.label === label);
  if (!repo || !branch || !base) {
    res.status(400).json({ error: "repo, branch and base are required" });
    return;
  }

  try {
    const result = await startLocalReview(
      repo.label,
      repo.path,
      branch,
      base,
      Array.isArray(skills) ? skills : [],
      model || undefined,
      effort || undefined
    );
    res.status(202).json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

localRouter.get("/local/reviews", (req, res) => {
  const label = String(req.query.repo ?? "");
  const db = getDb();
  const rows = label
    ? (db.prepare("SELECT * FROM reviews WHERE repo LIKE ? ORDER BY updated_at DESC").all(`local/${label}-%`) as ReviewRow[])
    : (db.prepare("SELECT * FROM reviews WHERE repo LIKE 'local/%' ORDER BY updated_at DESC").all() as ReviewRow[]);

  const reviews = rows.map((row) => {
    const findingCounts = db
      .prepare("SELECT state, COUNT(*) as cnt FROM findings WHERE review_id = ? GROUP BY state")
      .all(row.id) as { state: string; cnt: number }[];
    const open = findingCounts.find((f) => f.state === "open")?.cnt ?? 0;
    const posted = findingCounts.find((f) => f.state === "posted")?.cnt ?? 0;
    const total = findingCounts.reduce((n, f) => n + f.cnt, 0);
    let branch = "";
    let base = "";
    try {
      const snap = JSON.parse(row.snapshot || "{}");
      branch = snap.headRefName ?? "";
      base = snap.baseRefName ?? "";
    } catch {}
    return { ...toReviewDto(row), openFindings: open, postedFindings: posted, totalFindings: total, branch, base };
  });

  res.json(reviews);
});

localRouter.get("/local/reviews/latest", (req, res) => {
  const label = String(req.query.repo ?? "");
  const branch = String(req.query.branch ?? "");
  if (!label || !branch) {
    res.json(null);
    return;
  }

  const { repo, number } = localRepoIdentity(label, branch);
  const id = reviewId(repo, number);
  const review = loadReview(id);
  if (!review) {
    res.json(null);
    return;
  }

  const patches = splitUnifiedDiff(review.diff);
  const findings = loadFindings(id).map((row) => toFindingDto(row, patches));
  res.json({ ...toReviewDto(review), findings });
});
