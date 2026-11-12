import type Database from "better-sqlite3";
import { toReviewDto } from "./dto";
import type { RecentReviewDto, ReviewRow, Severity } from "../../../shared/types";

// The home screen: the latest PR reviews as cards, and what pasting a PR there does.

export type PasteVerdict = "start" | "running" | "unchanged";

/**
 * Pasting a PR starts a run only when it would read something new: nothing while a run is going, and
 * nothing when the last reported run already read `headSha`. A PR with no reported run of a known commit
 * always starts one.
 */
export function pasteVerdict(db: Database.Database, id: string, headSha: string): PasteVerdict {
  if (db.prepare("SELECT 1 FROM reviews WHERE id = ? AND status IN ('queued', 'running')").get(id)) return "running";
  const last = db
    .prepare("SELECT head_sha FROM review_runs WHERE review_id = ? AND status = 'reported' AND head_sha IS NOT NULL ORDER BY started_at DESC LIMIT 1")
    .get(id) as { head_sha: string } | undefined;
  return last?.head_sha === headSha ? "unchanged" : "start";
}

export function markApproved(db: Database.Database, id: string, now = new Date()): void {
  db.prepare("UPDATE reviews SET approved_at = ? WHERE id = ?").run(now.toISOString(), id);
}

/**
 * PR reviews only (local branches and comparisons have their own screens), most recently updated first.
 * The review of id `pin` comes first, however old it is.
 */
export function recentPrReviews(db: Database.Database, limit: number, offset: number, pin?: string): { reviews: RecentReviewDto[]; hasMore: boolean } {
  const PR_ONLY = "repo NOT LIKE 'local/%' AND repo NOT LIKE 'compare/%'";
  const rows = db.prepare(`SELECT * FROM reviews WHERE ${PR_ONLY} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`).all(limit + 1, offset) as ReviewRow[];
  const pinned = pin ? (db.prepare(`SELECT * FROM reviews WHERE id = ? AND ${PR_ONLY}`).get(pin) as ReviewRow | undefined) : undefined;
  const page = rows.slice(0, limit);
  const listed = pinned ? [pinned, ...page.filter((r) => r.id !== pinned.id)] : page;
  const findings = db.prepare(
    `SELECT f.id, f.severity, f.state, j.holds FROM findings f LEFT JOIN finding_judgments j ON j.finding_id = f.id
     WHERE f.review_id = ? AND f.state IN ('open', 'posted') ORDER BY f.ord ASC, f.id ASC`
  );
  const reviews = listed.map((row) => {
    const standing = findings.all(row.id) as { id: string; severity: Severity; state: string; holds: number | null }[];
    const severities: RecentReviewDto["severities"] = {};
    for (const f of standing) severities[f.severity] = (severities[f.severity] ?? 0) + 1;
    return {
      ...toReviewDto(row),
      severities,
      postedFindings: standing.filter((f) => f.state === "posted").length,
      openFindings: standing.filter((f) => f.state === "open").map((f) => ({ id: f.id, jevHolds: f.holds })),
      // updated_at moves when a run starts, reports, fails or is cancelled: an approval older than it is stale.
      approved: row.status === "reported" && !!row.approved_at && row.approved_at >= row.updated_at,
    };
  });
  return { reviews, hasMore: rows.length > limit };
}
