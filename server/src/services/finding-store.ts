import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Finding, FindingRow, PreviousFindingVerdict } from "../../../shared/types";

export type RunMode = "full" | "followup";

/**
 * A finding you have acted on: posted, dismissed, resolved, or open with a comment you edited.
 * A new run never deletes one of these.
 */
export function isTouched(row: Pick<FindingRow, "state" | "draft_comment" | "suggested_comment">): boolean {
  return row.state !== "open" || (row.draft_comment !== null && row.draft_comment !== row.suggested_comment);
}

/**
 * Saves what one run found. A full run replaces only the open findings nobody touched (it reads the
 * whole change again, so it finds them again); a follow-up run reads only the new commits, so it keeps
 * every earlier finding and records its verdict on each. A finding judged resolved while still open
 * leaves the open list; a posted or dismissed one keeps its state and just carries the verdict.
 * Findings imported from Deadpool (source set) are never replaced by a run.
 */
export function saveRunFindings(
  db: Database.Database,
  input: { reviewId: string; runId: string; mode: RunMode; findings: Finding[]; verdicts: PreviousFindingVerdict[] }
): void {
  const { reviewId, runId, mode, findings, verdicts } = input;
  const save = db.transaction(() => {
    // Reading the same run's report again replaces what that run saved, so it never doubles up.
    // Deadpool's findings come from its verdict files, not from a run: a run never replaces them.
    const replaceable = (mode === "full" ? "review_id = ?" : "review_id = ? AND run_id = ?") + " AND source IS NULL";
    const existing = db
      .prepare(`SELECT id, state, draft_comment, suggested_comment FROM findings WHERE ${replaceable}`)
      .all(...(mode === "full" ? [reviewId] : [reviewId, runId])) as Pick<FindingRow, "id" | "state" | "draft_comment" | "suggested_comment">[];
    const remove = db.prepare("DELETE FROM findings WHERE id = ?");
    for (const row of existing) if (!isTouched(row)) remove.run(row.id);

    const ownIds = new Set((db.prepare("SELECT id FROM findings WHERE review_id = ?").all(reviewId) as { id: string }[]).map((r) => r.id));
    const judge = db.prepare(
      `UPDATE findings SET followup_status = @status, followup_note = @note,
         state = CASE WHEN @status = 'resolved' AND state = 'open' THEN 'resolved' ELSE state END
       WHERE id = @id`
    );
    for (const v of verdicts) if (ownIds.has(v.id)) judge.run(v);

    const { next } = db.prepare("SELECT COALESCE(MAX(ord) + 1, 0) AS next FROM findings WHERE review_id = ?").get(reviewId) as { next: number };
    const insert = db.prepare(
      `INSERT INTO findings (
        id, review_id, run_id, created_at, ord, file, start_line, end_line, side, severity, category, title,
        summary, background, problem, suggested_fix, suggested_comment, draft_comment,
        state, comment_url, posted_at, posted_as, references_json
      ) VALUES (
        @id, @review_id, @run_id, @created_at, @ord, @file, @start_line, @end_line, @side, @severity, @category, @title,
        @summary, @background, @problem, @suggested_fix, @suggested_comment, @draft_comment,
        'open', NULL, NULL, 'comment', @references_json
      )`
    );
    const createdAt = new Date().toISOString();
    findings.forEach((f, i) =>
      insert.run({
        id: randomUUID(),
        review_id: reviewId,
        run_id: runId,
        created_at: createdAt,
        ord: next + i,
        file: f.file,
        start_line: f.startLine,
        end_line: f.endLine,
        side: f.side,
        severity: f.severity,
        category: f.category,
        title: f.title,
        summary: f.summary,
        background: f.background,
        problem: f.problem,
        suggested_fix: f.suggestedFix,
        suggested_comment: f.suggestedComment,
        draft_comment: f.suggestedComment,
        references_json: JSON.stringify(f.references),
      })
    );
  });
  save();
}
