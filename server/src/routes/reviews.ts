import { Router } from "express";
import { getDb } from "../db/schema";
import { reviewEvents, reviewOutcomes, reviewId, startReview, getThreadLog, reimportRun } from "../services/review-engine";
import { splitUnifiedDiff, findPatchForFile } from "../services/diff-utils";
import { toFindingDto, toReviewDto } from "../services/dto";
import { getRunSession, listRuns } from "../services/run-log";
import { isRepoName } from "../services/repo-selection";
import type { FindingRow, ReviewEvent, ReviewOutcome, ReviewRow } from "../../../shared/types";

export const reviewsRouter = Router();

function rlog(...args: unknown[]): void {
  console.log("[route:reviews]", ...args);
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
  const { repo, number, skills, model, effort, challengeExisting } = req.body as {
    repo?: string;
    number?: number;
    skills?: string[];
    model?: string;
    effort?: string;
    challengeExisting?: boolean;
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
      challengeExisting !== false
    );
    rlog(`review started: id=${id}`);
    res.status(202).json({ id });
  } catch (err) {
    rlog(`POST /reviews FAILED: ${(err as Error).message}`);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.get("/reviews/latest", (req, res) => {
  const repo = String(req.query.repo ?? "");
  const num = Number(req.query.number);
  if (!repo || !Number.isFinite(num)) {
    res.json(null);
    return;
  }

  const id = reviewId(repo, num);
  const review = loadReview(id);
  if (!review) {
    res.json(null);
    return;
  }

  const patches = splitUnifiedDiff(review.diff);
  const findings = loadFindings(id).map((row) => toFindingDto(row, patches));
  res.json({ ...toReviewDto(review), findings });
});

reviewsRouter.get("/reviews/:owner/:name/:number", (req, res) => {
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
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
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));

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
    rlog(`submitted ${event} on ${repo}#${num}: ${result.url}`);
    res.json(result);
  } catch (err) {
    rlog(`submit FAILED: ${(err as Error).message}`);
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

reviewsRouter.get("/reviews/:owner/:name/:number/thread", (req, res) => {
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  res.json({ log: getThreadLog(id) });
});

reviewsRouter.get("/reviews/:owner/:name/:number/runs", (req, res) => {
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
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
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  res.json({ diff: review.diff });
});

reviewsRouter.get("/reviews/:owner/:name/:number/diff/*file", (req, res) => {
  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
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

  const id = reviewId(`${req.params.owner}/${req.params.name}`, Number(req.params.number));
  const review = loadReview(id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  const openFindings = loadFindings(id).filter((f) => f.state === "open");
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
