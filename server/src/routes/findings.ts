import { Router } from "express";
import { getDb } from "../db/schema";
import { track } from "../db/telemetry";
import { splitUnifiedDiff, findPatchForFile, diffHunkRanges, resolvePostAnchor } from "../services/diff-utils";
import { getHeadSha, postFileComment, postInlineComment, postIssueComment } from "../services/github";
import type { FindingRow, ReviewRow } from "../../../shared/types";

export const findingsRouter = Router();

// What you do with a finding (draft edited, posted, dismissed, reopened), recorded once it succeeded.
findingsRouter.use((req, res, next) => {
  const m = req.path.match(/^\/findings\/([^/]+)\/(comment|state|post|dismiss|reopen)$/);
  if (!m || req.method === "GET") return next();
  const start = Date.now();
  res.on("finish", () => {
    const finding = loadFinding(m[1]);
    track("finding", m[2], {
      reviewId: finding?.review_id ?? null,
      status: res.statusCode < 400 ? "ok" : "error",
      durationMs: Date.now() - start,
      payload: { findingId: m[1], severity: finding?.severity ?? null, file: finding?.file ?? null, state: finding?.state ?? null, mode: (req.body as { mode?: string })?.mode ?? null, httpStatus: res.statusCode },
    });
  });
  next();
});

function loadFinding(id: string): FindingRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as FindingRow | undefined;
}

function loadReviewById(reviewId: string): ReviewRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(reviewId) as ReviewRow | undefined;
}

findingsRouter.patch("/findings/:id/comment", (req, res) => {
  const body = req.body as { comment?: string; draftComment?: string };
  const comment = body.draftComment ?? body.comment;
  if (typeof comment !== "string") {
    res.status(400).json({ error: "comment or draftComment is required" });
    return;
  }

  const finding = loadFinding(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "finding not found" });
    return;
  }

  const db = getDb();
  db.prepare("UPDATE findings SET draft_comment = ? WHERE id = ?").run(comment, finding.id);
  res.json({ ok: true });
});

findingsRouter.patch("/findings/:id/state", (req, res) => {
  const { state } = req.body as { state?: string };
  if (state !== "open" && state !== "dismissed") {
    res.status(400).json({ error: 'state must be "open" or "dismissed"' });
    return;
  }

  const finding = loadFinding(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "finding not found" });
    return;
  }

  const db = getDb();
  db.prepare("UPDATE findings SET state = ? WHERE id = ?").run(state, finding.id);
  res.json({ ok: true });
});

findingsRouter.post("/findings/:id/post", async (req, res) => {
  const { mode } = req.body as { mode?: "inline" | "issue" | "review" };
  if (mode !== "inline" && mode !== "issue" && mode !== "review") {
    res.status(400).json({ error: 'mode must be "inline", "issue" or "review"' });
    return;
  }

  const finding = loadFinding(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "finding not found" });
    return;
  }

  const review = loadReviewById(finding.review_id);
  if (!review) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  const body = finding.draft_comment ?? finding.suggested_comment;

  try {
    const commitId = await getHeadSha(review.repo, review.number);

    let result: { url: string };
    let postedAs: "comment" | "pending-review" = "comment";

    if (mode === "issue") {
      result = await postIssueComment(review.repo, review.number, body);
    } else {
      const side = finding.side === "LEFT" ? "LEFT" : "RIGHT";
      const patches = splitUnifiedDiff(review.diff);
      const patch = findPatchForFile(patches, finding.file);
      const ranges = patch ? diffHunkRanges(patch.patch, side) : [];
      const anchor = resolvePostAnchor(
        { file: finding.file, startLine: finding.start_line, endLine: finding.end_line, side },
        ranges,
        Boolean(patch)
      );

      if (anchor.kind === "line" && anchor.line !== null) {
        result = await postInlineComment(
          review.repo,
          review.number,
          body,
          commitId,
          finding.file,
          anchor.line,
          side,
          anchor.startLine
        );
      } else if (anchor.kind === "file") {
        result = await postFileComment(review.repo, review.number, body, commitId, finding.file);
      } else {
        result = await postIssueComment(review.repo, review.number, body);
      }

      if (mode === "review") postedAs = "pending-review";
    }

    const db = getDb();
    db.prepare(
      "UPDATE findings SET state = 'posted', comment_url = ?, posted_at = ?, posted_as = ? WHERE id = ?"
    ).run(result.url, new Date().toISOString(), postedAs, finding.id);

    res.json({ ok: true, url: result.url });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

findingsRouter.patch("/findings/:id/dismiss", (req, res) => {
  const finding = loadFinding(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "finding not found" });
    return;
  }
  const db = getDb();
  db.prepare("UPDATE findings SET state = 'dismissed' WHERE id = ?").run(finding.id);
  res.json({ ok: true });
});

findingsRouter.patch("/findings/:id/reopen", (req, res) => {
  const finding = loadFinding(req.params.id);
  if (!finding) {
    res.status(404).json({ error: "finding not found" });
    return;
  }
  const db = getDb();
  db.prepare("UPDATE findings SET state = 'open' WHERE id = ?").run(finding.id);
  res.json({ ok: true });
});
