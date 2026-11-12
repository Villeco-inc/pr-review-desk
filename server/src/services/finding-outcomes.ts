// What reviewers did with the findings (posted, dismissed, still open, resolved by a later commit),
// by severity, by the model and effort that produced them, and by repository; and how Jev's verdicts
// line up with those decisions.

import type Database from "better-sqlite3";
import type { FindingOutcomeCounts, FindingQualitySummaryDto, JevVerdictRow } from "../../../shared/types";

export interface FindingOutcomeRow {
  id: string;
  review_id: string;
  severity: string;
  state: string;
  run_id: string | null;
  model: string | null;
  effort: string | null;
  nit: number | null;
  holds: number | null;
  severity_score: number | null;
}

/** Applied when reading, so they can be tuned without judging again. Between the two, the answer is uncertain. */
export const JEV_THRESHOLDS = { yes: 0.6, no: 0.4 };

/**
 * One row per finding produced in the period, with the run that produced it: `findings.run_id` when set,
 * otherwise the review's latest reported run (findings of a review are replaced by each reported run,
 * so that run is the one that wrote them). When `findings.created_at` exists, the fallback only looks at
 * runs that finished before it. A finding with no run at all (older than run logging) dates from its review.
 */
export function findingOutcomeRows(db: Database.Database, since: string): FindingOutcomeRow[] {
  const columns = new Set((db.prepare("PRAGMA table_info(findings)").all() as { name: string }[]).map((c) => c.name));
  const beforeCreation = columns.has("created_at") ? "AND (f.created_at IS NULL OR x.finished_at <= f.created_at)" : "";
  return db
    .prepare(
      `WITH attributed AS (
         SELECT f.id, f.review_id, f.severity, f.state,
           COALESCE(f.run_id, (
             SELECT x.id FROM review_runs x
             WHERE x.review_id = f.review_id AND x.status = 'reported' ${beforeCreation}
             ORDER BY COALESCE(x.finished_at, x.started_at) DESC LIMIT 1
           )) AS run_id
         FROM findings f
       )
       SELECT a.id, a.review_id, a.severity, a.state, r.id AS run_id, r.model, r.effort, j.nit, j.holds, j.severity_score
       FROM attributed a
       LEFT JOIN review_runs r ON r.id = a.run_id
       LEFT JOIN reviews v ON v.id = a.review_id
       LEFT JOIN finding_judgments j ON j.finding_id = a.id
       WHERE COALESCE(r.finished_at, r.started_at, v.updated_at) >= ?`
    )
    .all(since) as FindingOutcomeRow[];
}

/** `owner/repo#12` → `owner/repo`; `local/linea-web-1b482977cc#0` → `local/linea-web` (the hash names a branch, not a repo). */
export function repoOf(reviewId: string): string {
  const base = reviewId.includes("#") ? reviewId.slice(0, reviewId.lastIndexOf("#")) : reviewId;
  return /^(local|compare)\//.test(base) ? base.replace(/-[0-9a-f]{10}$/, "") : base;
}

const empty = (): FindingOutcomeCounts => ({ total: 0, open: 0, posted: 0, dismissed: 0, resolved: 0 });

function count(into: FindingOutcomeCounts, state: string): void {
  into.total++;
  if (state === "open" || state === "posted" || state === "dismissed" || state === "resolved") into[state]++;
}

function groupBy<K extends Record<string, string>>(rows: FindingOutcomeRow[], key: (r: FindingOutcomeRow) => K): (FindingOutcomeCounts & K)[] {
  const groups = new Map<string, FindingOutcomeCounts & K>();
  for (const r of rows) {
    const k = key(r);
    const id = JSON.stringify(k);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { ...k, ...empty() }));
    count(g, r.state);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "nit"];

export function summarizeFindingOutcomes(rows: FindingOutcomeRow[], jevEnabled: boolean): FindingQualitySummaryDto {
  const totals = empty();
  for (const r of rows) count(totals, r.state);

  const bySeverity = groupBy(rows, (r) => ({ severity: r.severity })).sort(
    (a, b) => (SEVERITY_ORDER.indexOf(a.severity) + 1 || 99) - (SEVERITY_ORDER.indexOf(b.severity) + 1 || 99)
  );

  const verdicts = new Map<JevVerdictRow["verdict"], JevVerdictRow>();
  const tally = (verdict: JevVerdictRow["verdict"], state: string) => {
    let v = verdicts.get(verdict);
    if (!v) verdicts.set(verdict, (v = { verdict, ...empty() }));
    count(v, state);
  };
  const read = (p: number) => (p >= JEV_THRESHOLDS.yes ? "yes" : p <= JEV_THRESHOLDS.no ? "no" : "uncertain");
  const decisions = new Map<string, { judged: number; nit: number; holds: number; severity: number }>();
  let judged = 0;
  for (const r of rows) {
    // A finding Jev did not answer for is "unjudged", never "no".
    if (r.nit === null || r.holds === null) {
      tally("unjudged", r.state);
      continue;
    }
    judged++;
    tally(({ yes: "nit", no: "not-nit", uncertain: "nit-uncertain" } as const)[read(r.nit)], r.state);
    tally(({ yes: "holds", no: "fails", uncertain: "holds-uncertain" } as const)[read(r.holds)], r.state);
    const d = decisions.get(r.state) ?? { judged: 0, nit: 0, holds: 0, severity: 0 };
    decisions.set(r.state, { judged: d.judged + 1, nit: d.nit + r.nit, holds: d.holds + r.holds, severity: d.severity + (r.severity_score ?? 0) });
  }
  const order: JevVerdictRow["verdict"][] = ["nit", "nit-uncertain", "not-nit", "fails", "holds-uncertain", "holds", "unjudged"];
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    totals,
    bySeverity,
    byModel: groupBy(rows, (r) => ({ model: r.run_id ? (r.model ?? "default") : "unknown", effort: r.effort ?? "—" })),
    byRepo: groupBy(rows, (r) => ({ repo: repoOf(r.review_id) })),
    jev: {
      enabled: jevEnabled,
      judged,
      thresholds: JEV_THRESHOLDS,
      verdicts: order.flatMap((v) => verdicts.get(v) ?? []),
      byDecision: [...decisions].map(([state, d]) => ({ state, judged: d.judged, meanNit: round(d.nit / d.judged), meanHolds: round(d.holds / d.judged), meanSeverity: round(d.severity / d.judged) })),
    },
  };
}
