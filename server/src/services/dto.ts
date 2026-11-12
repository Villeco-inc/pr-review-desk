import type { FindingDto, FindingRow, ReviewDto, ReviewRow } from "../../../shared/types";
import { diffHunkRanges, findPatchForFile, resolvePostAnchor, type FilePatch } from "./diff-utils";

export function toReviewDto(row: ReviewRow): ReviewDto {
  return {
    id: row.id,
    repo: row.repo,
    number: row.number,
    title: row.title,
    status: row.status as ReviewDto["status"],
    summary: row.summary,
    error: row.error,
    skills: JSON.parse(row.skills || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFindingDto(row: FindingRow, patches: FilePatch[]): FindingDto {
  const patch = findPatchForFile(patches, row.file);
  const side = row.side === "LEFT" ? "LEFT" : "RIGHT";
  const ranges = patch ? diffHunkRanges(patch.patch, side) : [];
  const postAnchor = resolvePostAnchor(
    { file: row.file, startLine: row.start_line, endLine: row.end_line, side },
    ranges,
    Boolean(patch)
  );

  return {
    id: row.id,
    reviewId: row.review_id,
    file: row.file,
    startLine: row.start_line,
    endLine: row.end_line,
    side,
    severity: row.severity as FindingDto["severity"],
    category: row.category,
    title: row.title,
    summary: row.summary,
    background: row.background,
    problem: row.problem,
    suggestedFix: row.suggested_fix,
    suggestedComment: row.suggested_comment,
    draftComment: row.draft_comment,
    state: row.state as FindingDto["state"],
    runId: row.run_id ?? null,
    followupStatus: (row.followup_status as FindingDto["followupStatus"]) ?? null,
    followupNote: row.followup_note ?? null,
    commentUrl: row.comment_url,
    postedAt: row.posted_at,
    postedAs: row.posted_as as FindingDto["postedAs"],
    references: JSON.parse(row.references_json || "[]"),
    postAnchor,
    source: row.source === "deadpool" ? "deadpool" : "desk",
  };
}
