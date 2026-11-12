import { Router } from "express";
import { getDb } from "../db/schema";
import { reviewEvents, reviewOutcomes, reviewId, startReview, getThreadLog, reimportRun, cleanInstructions, cancelReview } from "../services/review-engine";
import { splitUnifiedDiff, findPatchForFile } from "../services/diff-utils";
import { approvalWarnings, failingChecks } from "../services/approval";
import { toFindingDto, toReviewDto } from "../services/dto";
import { getRunSession, listRuns } from "../services/run-log";
import { followRepo, isRepoName, selectedRepoNamed } from "../services/repo-selection";
import { findReview } from "../services/review-lookup";
import { markApproved, pasteVerdict, recentPrReviews } from "../services/recent-reviews";
import { configuredRepos } from "./prs";
import type { FindingRow, PasteReviewDto, RecentReviewsDto, ReviewEvent, ReviewOutcome, ReviewRow } from "../../../shared/types";

export const reviewsRouter = Router();

function rlog(...args: unknown[]): void {
  console.log("[route:reviews]", ...args);
}

/** The id a pull request's review was stored under, whatever the case its repository was written in then. */
function idOf(repo: string, num: number): string {
  return findReview(getDb(), repo, num)?.id ?? reviewId(repo, num);
}

function loadReview(id: string): ReviewRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow | undefined;
}

function loadFindings(id: string): FindingRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM findings WHERE review_id = ? ORDER BY ord ASC").all(id) as FindingRow[];
}

reviewsRouter.post("/reviews", async (req, res) => {
  const { repo, number, skills, model, effort, challengeExisting, instructions } = req.body as {
    repo?: string;
    number?: number;
    skills?: string[];
    model?: string;
    effort?: string;
    challengeExisting?: boolean;
    instructions?: string;
  };
  rlog(`POST /reviews body=${JSON.stringify({ repo, number, skills, model, effort, challengeExisting })}`);

  if (!repo || !Number.isFinite(number)) {
    rlog("POST /reviews 400: missing repo or number");
    res.status(400).json({ error: "repo and number are required" });
    return;
  }
  if (!isRepoName(repo)) {
    rlog("POST /reviews 400: repo is not owner/name");
    res.status(400).json({ error: "repo must be owner/name" });
    return;
  }

  try {
    rlog(`starting review for ${repo}#${number} skills=[${(skills ?? []).join(",")}] model=${model ?? "default"} effort=${effort ?? "standard"}`);
    const id = await startReview(
      repo,
      Number(number),
      Array.isArray(skills) ? skills : [],
      model || undefined,
      effort || undefined,
      challengeExisting !== false,
      cleanInstructions(instructions)
    );
    rlog(`review started: id=${id}`);
    res.status(202).json({ id });
  } catch (err) {
    rlog(`POST /reviews FAILED: ${(err as Error).message}`);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * A PR pasted on the home screen. Unlike POST /reviews, it refuses a repository that is not followed
 * (unless asked to follow it first) and starts no run that would read nothing new.
 */
reviewsRouter.post("/reviews/paste", async (req, res) => {
  const { repo, number, model, effort, follow } = req.body as { repo?: string; number?: number; model?: string; effort?: string; follow?: boolean };
  rlog(`POST /reviews/paste body=${JSON.stringify({ repo, number, model, effort, follow })}`);

  if (!isRepoName(repo) || !Number.isInteger(number) || Number(number) <= 0) {
    res.status(400).json({ error: "repo (owner/name) and number are required" });
    return;
  }

  const followed = configuredRepos();
  const listed = selectedRepoNamed(repo, followed);
  if (!listed && follow !== true) {
    res.status(409).json({ error: `${repo} is not a followed repository`, code: "not-followed" });
    return;
  }

  try {
    const { getHeadSha } = await import("../services/github");
    // A PR already reviewed keeps the spelling its review was stored under, so a different case starts no second review.
    const name = findReview(getDb(), repo, Number(number))?.repo ?? listed ?? repo;
    // Read from GitHub before following: a repository that is mistyped or out of reach is never followed.
    const headSha = await getHeadSha(name, Number(number));
    if (!listed) followRepo(getDb(), followed, repo);

    const id = reviewId(name, Number(number));
    const verdict = pasteVerdict(getDb(), id, headSha);
    if (verdict !== "start") {
      res.json({ id, started: false, reason: verdict } satisfies PasteReviewDto);
      return;
    }
    await startReview(name, Number(number), [], model || undefined, effort || undefined);
    res.status(202).json({ id, started: true } satisfies PasteReviewDto);
  } catch (err) {
    rlog(`POST /reviews/paste FAILED: ${(err as Error).message}`);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.get("/reviews/recent", (req, res) => {
  // No upper bound: the home screen grows its limit by a page each time more is asked for.
  const limit = Math.max(Number(req.query.limit) || 20, 1);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const pin = typeof req.query.pin === "string" && req.query.pin ? req.query.pin : undefined;
  res.json({ ...recentPrReviews(getDb(), limit, offset, pin), jevEnabled: Boolean(process.env.TYPESAFE_API_KEY?.trim()) } satisfies RecentReviewsDto);
});

reviewsRouter.get("/reviews/latest", (req, res) => {
  const repo = String(req.query.repo ?? "");
  const num = Number(req.query.number);
  if (!repo || !Number.isFinite(num)) {
    res.json(null);
    return;
  }

  const id = idOf(repo, num);
  const review = loadReview(id);
  if (!review) {
    res.json(null);
    return;
  }

  const patches = splitUnifiedDiff(review.diff);
  const holds = new Map(
    (getDb().prepare("SELECT finding_id, holds FROM finding_judgments WHERE review_id = ?").all(id) as { finding_id: string; holds: number | null }[]).map((j) => [j.finding_id, j.holds])
  );
  const findings = loadFindings(id).map((row) => ({ ...toFindingDto(row, patches), jevHolds: holds.get(row.id) ?? null }));
  res.json({ ...toReviewDto(review), findings });
});

reviewsRouter.get("/reviews/:owner/:name/:number", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  const patches = splitUnifiedDiff(review.diff);
  const findings = loadFindings(id).map((row) => toFindingDto(row, patches));

  res.json({ review: toReviewDto(review), findings });
});

reviewsRouter.get("/reviews/outcomes", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const listener = (outcome: ReviewOutcome) => res.write(`data: ${JSON.stringify(outcome)}\n\n`);
  reviewOutcomes.on("outcome", listener);
  req.on("close", () => reviewOutcomes.off("outcome", listener));
});

reviewsRouter.get("/reviews/:owner/:name/:number/events", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: ReviewEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const listener = (event: ReviewEvent) => send(event);
  reviewEvents.on(id, listener);

  const review = loadReview(id);
  if (review) {
    send({ type: "status", reviewId: id, data: { status: review.status } });
  }

  req.on("close", () => {
    reviewEvents.off(id, listener);
  });
});

reviewsRouter.post("/reviews/:owner/:name/:number/cancel", (req, res) => {
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  rlog(`POST cancel ${id}`);
  if (!cancelReview(id)) {
    res.status(409).json({ error: "no review of this target is running" });
    return;
  }
  res.json({ ok: true });
});

reviewsRouter.get("/reviews/:owner/:name/:number/approval-check", async (req, res) => {
  const { fetchCheckRollup } = await import("../services/github");
  const repo = `${req.params.owner}/${req.params.name}`;
  const num = Number(req.params.number);
  try {
    const checks = failingChecks(await fetchCheckRollup(repo, num));
    res.json({ warnings: approvalWarnings(loadFindings(reviewId(repo, num)), checks) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.post("/reviews/:owner/:name/:number/submit", async (req, res) => {
  const { submitReview, getHeadSha } = await import("../services/github");
  const repo = `${req.params.owner}/${req.params.name}`;
  const num = Number(req.params.number);
  const { event, body } = req.body as { event?: string; body?: string };
  rlog(`POST submit ${repo}#${num} event=${event}`);

  if (!isRepoName(repo)) {
    res.status(400).json({ error: "repo must be owner/name" });
    return;
  }
  if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT") {
    res.status(400).json({ error: 'event must be "APPROVE", "REQUEST_CHANGES" or "COMMENT"' });
    return;
  }
  if (event !== "APPROVE" && !(body ?? "").trim()) {
    res.status(400).json({ error: "a body is required for REQUEST_CHANGES and COMMENT" });
    return;
  }

  try {
    const commitId = await getHeadSha(repo, num);
    const result = await submitReview(repo, num, event, body ?? "", commitId);
    if (event === "APPROVE") markApproved(getDb(), idOf(repo, num));
    rlog(`submitted ${event} on ${repo}#${num}: ${result.url}`);
    res.json(result);
  } catch (err) {
    rlog(`submit FAILED: ${(err as Error).message}`);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.get("/reviews/:owner/:name/:number/thread", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  res.json({ log: getThreadLog(id) });
});

reviewsRouter.get("/reviews/:owner/:name/:number/runs", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  res.json(listRuns(id));
});

reviewsRouter.post("/runs/:runId/reimport", (req, res) => {
  try {
    res.json(reimportRun(req.params.runId));
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.get("/runs/:runId", (req, res) => {
  const session = getRunSession(req.params.runId);
  if (!session) {
    res.status(404).json({ error: "run not found" });
    return;
  }
  res.json(session);
});

reviewsRouter.get("/reviews/:owner/:name/:number/diff", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  res.json({ diff: review.diff });
});

reviewsRouter.get("/reviews/:owner/:name/:number/diff/*file", (req, res) => {
  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  const file = Array.isArray(req.params.file) ? req.params.file.join("/") : String(req.params.file ?? "");
  const patches = splitUnifiedDiff(review.diff);
  const patch = findPatchForFile(patches, file);
  if (!patch) {
    res.status(404).json({ error: "file not found in diff" });
    return;
  }

  res.json({ file: patch.file, patch: patch.patch });
});

reviewsRouter.post("/reviews/:owner/:name/:number/post-all", async (req, res) => {
  const { postInlineComment, postFileComment, postIssueComment, getHeadSha } = await import("../services/github");
  const { diffHunkRanges, resolvePostAnchor, findPatchForFile } = await import("../services/diff-utils");

  const id = idOf(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  // Without `ids`, every open finding; with it, only those of them still open.
  const { ids } = (req.body ?? {}) as { ids?: unknown };
  const wanted = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  const openFindings = loadFindings(id).filter((f) => f.state === "open" && (!wanted || wanted.has(f.id)));
  if (openFindings.length === 0) {
    res.json({ posted: 0 });
    return;
  }

  try {
    const commitId = await getHeadSha(review.repo, review.number);
    const patches = splitUnifiedDiff(review.diff);
    const db = getDb();
    let posted = 0;

    for (const finding of openFindings) {
      const body = finding.draft_comment ?? finding.suggested_comment;
      const side = finding.side === "LEFT" ? "LEFT" : "RIGHT";
      const patch = findPatchForFile(patches, finding.file);
      const ranges = patch ? diffHunkRanges(patch.patch, side) : [];
      const anchor = resolvePostAnchor(
        { file: finding.file, startLine: finding.start_line, endLine: finding.end_line, side },
        ranges,
        Boolean(patch)
      );

      let result: { url: string };
      if (anchor.kind === "line" && anchor.line !== null) {
        result = await postInlineComment(review.repo, review.number, body, commitId, finding.file, anchor.line, side, anchor.startLine);
      } else if (anchor.kind === "file") {
        result = await postFileComment(review.repo, review.number, body, commitId, finding.file);
      } else {
        result = await postIssueComment(review.repo, review.number, body);
      }

      db.prepare("UPDATE findings SET state = 'posted', comment_url = ?, posted_at = ?, posted_as = 'comment' WHERE id = ?")
        .run(result.url, new Date().toISOString(), finding.id);
      posted++;
    }

    res.json({ posted });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
