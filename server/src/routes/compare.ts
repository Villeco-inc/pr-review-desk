import { Router } from "express";
import { getDb } from "../db/schema";
import { fetchCompare, fetchRepoRefs } from "../services/github";
import { compareIdentity, reviewId, startCompareReview } from "../services/review-engine";
import { splitUnifiedDiff } from "../services/diff-utils";
import { toFindingDto, toReviewDto } from "../services/dto";
import { selectedRepoNamed } from "../services/repo-selection";
import { configuredRepos } from "./prs";
import type { FindingRow, ReviewRow } from "../../../shared/types";

export const compareRouter = Router();

/** Only the configured repos: this route shells out to gh with the user's token. */
function knownRepo(value: unknown): string | null {
  return selectedRepoNamed(String(value ?? ""), configuredRepos());
}

const fail = (res: import("express").Response, err: unknown) =>
  res.status(502).json({ error: err instanceof Error ? err.message : String(err) });

compareRouter.get("/compare/refs", async (req, res) => {
  const repo = knownRepo(req.query.repo);
  if (!repo) return void res.status(400).json({ error: "unknown repo" });
  try {
    res.json(await fetchRepoRefs(repo));
  } catch (err) {
    fail(res, err);
  }
});

compareRouter.get("/compare/summary", async (req, res) => {
  const repo = knownRepo(req.query.repo);
  const base = String(req.query.base ?? "");
  const head = String(req.query.head ?? "");
  if (!repo || !base || !head) return void res.status(400).json({ error: "repo, base and head are required" });
  try {
    res.json(await fetchCompare(repo, base, head));
  } catch (err) {
    fail(res, err);
  }
});

compareRouter.post("/compare/reviews", async (req, res) => {
  const { repo: rawRepo, base, head, skills, model, effort } = req.body as {
    repo?: string;
    base?: string;
    head?: string;
    skills?: string[];
    model?: string;
    effort?: string;
  };
  const repo = knownRepo(rawRepo);
  if (!repo || !base || !head) return void res.status(400).json({ error: "repo, base and head are required" });
  try {
    res.status(202).json(await startCompareReview(repo, base, head, Array.isArray(skills) ? skills : [], model || undefined, effort || undefined));
  } catch (err) {
    fail(res, err);
  }
});

compareRouter.get("/compare/reviews/latest", (req, res) => {
  const repo = knownRepo(req.query.repo);
  const head = String(req.query.head ?? "");
  if (!repo || !head) return void res.json(null);
  const identity = compareIdentity(repo, head);
  const id = reviewId(identity.repo, identity.number);
  const db = getDb();
  const review = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
  if (!review) return void res.json(null);
  const patches = splitUnifiedDiff(review.diff);
  const findings = (db.prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY ord ASC").all(id) as FindingRow[]).map((row) =>
    toFindingDto(row, patches)
  );
  let base = "";
  try {
    base = JSON.parse(review.snapshot || "{}").baseRefName ?? "";
  } catch {}
  res.json({ ...toReviewDto(review), findings, base });
});
