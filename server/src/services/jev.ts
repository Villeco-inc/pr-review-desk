// Jev (TypeSafe's System One model) judges each new finding once its review has reported, through the
// TypeSafe SDK, server side only. On only when TYPESAFE_API_KEY is set.
//
// One request per finding asks three independent questions over the same state: is it a nit (Noul), how
// severe is the defect if real (Score), and does it hold as a checkable claim with a concrete scenario (Noul).
// The raw probabilities are stored, not verdicts: thresholds are applied when reading, so they can be tuned
// against what reviewers posted and dismissed. Whatever goes wrong (no key, an API error, a timeout, an
// answer missing) the review is untouched and nothing is stored for that finding: it stays "unjudged".

import type Database from "better-sqlite3";
import type { EventEmitter } from "node:events";
import { AuthenticationError, PermissionDeniedError, TypeSafeClient, noul, score, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import type { ReviewOutcome } from "../../../shared/types";
import { track } from "../db/telemetry";

/** Pinned rather than `jev-latest`, so probabilities stored over time stay comparable. */
export const JEV_MODEL = "jev-1.13.0";
const CONCURRENCY = 4;

/** A client when TYPESAFE_API_KEY is set, otherwise null (Jev off). The key never leaves the server. */
export function jevClientFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: TypeSafeClientConfig = {}): TypeSafeClient | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;
  return new TypeSafeClient({ apiKey, defaultModel: env.JEV_MODEL?.trim() || JEV_MODEL, timeout: 15_000, logLevel: "off", ...overrides });
}

export const QUESTIONS = {
  nit: noul("Is `finding` a nit: a remark about style, naming, wording, formatting, or personal preference, rather than a defect in what the code does?", {
    true: "Changing it would not change behaviour, e.g. 'rename x to count', 'this comment is out of date'",
    false: "It describes behaviour that is wrong or unsafe for some input, state, or sequence of events",
  }),
  severity: score(
    "If the defect described by `finding` is real, how severe are its consequences? Judge the consequence described in `finding.problem`, independently of `finding.given_severity` and of how sure the reviewer sounds.",
    [
      "Cosmetic or stylistic: no effect on behaviour",
      "Minor: wrong only in an unusual edge case, with little impact when it happens",
      "Moderate: incorrect behaviour a user would notice on a plausible path, with a workaround",
      "Serious: crash, data loss, or wrong result on a common path, with no workaround",
      "Critical: security exposure, money, or irreversible damage",
    ]
  ),
  holds: noul(
    "Does `finding` hold as a checkable claim: `finding.summary` states one specific thing that is wrong, and `finding.problem` names concrete inputs or state and the wrong result that follows, so a reader could reproduce it?",
    {
      true: "A specific defect and a reproducible case, e.g. 'retries never back off: with a host that never answers, the client loops without delay'",
      false: "A vague worry, a restated summary, advice, or a rationale with no case a reader could check",
    }
  ),
};

interface FindingRow {
  id: string;
  file: string;
  start_line: number | null;
  end_line: number | null;
  severity: string;
  title: string;
  summary: string;
  problem: string;
}

/** Only what the three questions need: the finding's text and where it points. */
export function jevState(f: FindingRow) {
  const lines = f.start_line == null ? null : f.end_line != null && f.end_line !== f.start_line ? `${f.start_line}-${f.end_line}` : String(f.start_line);
  return { finding: { title: f.title, summary: f.summary, problem: f.problem, given_severity: f.severity, file: f.file, lines } };
}

const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function mapBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Judges the review's findings that have no answer yet. Returns how many were stored and why others were not. */
export async function judgeReviewFindings(db: Database.Database, client: TypeSafeClient, reviewId: string): Promise<{ judged: number; skipped: string[] }> {
  const findings = db
    .prepare(
      `SELECT f.id, f.file, f.start_line, f.end_line, f.severity, f.title, f.summary, f.problem FROM findings f
       WHERE f.review_id = ? AND NOT EXISTS (SELECT 1 FROM finding_judgments j WHERE j.finding_id = f.id) ORDER BY f.ord`
    )
    .all(reviewId) as FindingRow[];
  // A re-run may replace the findings while Jev answers: store only for findings that still exist.
  const insert = db.prepare(
    `INSERT OR REPLACE INTO finding_judgments (finding_id, review_id, judged_at, model, nit, holds, severity_score, severity_confidence, severity_probabilities, input_tokens, output_tokens)
     SELECT @finding_id, @review_id, @judged_at, @model, @nit, @holds, @severity_score, @severity_confidence, @severity_probabilities, @input_tokens, @output_tokens
     WHERE EXISTS (SELECT 1 FROM findings WHERE id = @finding_id)`
  );
  const skipped = new Set<string>();
  let judged = 0;
  let refused = false;

  await mapBounded(findings, CONCURRENCY, async (f) => {
    if (refused) return;
    try {
      const { model, answers, usage } = await client.systemOne({ state: jevState(f), questions: QUESTIONS });
      const nit = finite(answers.nit?.noul);
      const holds = finite(answers.holds?.noul);
      const severity = finite(answers.severity?.score);
      if (nit === null || holds === null || severity === null) {
        skipped.add("malformed answer");
        return;
      }
      judged += insert.run({
        finding_id: f.id,
        review_id: reviewId,
        judged_at: new Date().toISOString(),
        model,
        nit,
        holds,
        severity_score: severity,
        severity_confidence: finite(answers.severity.confidence),
        severity_probabilities: JSON.stringify(answers.severity.probabilities ?? {}),
        input_tokens: usage?.input_tokens ?? null,
        output_tokens: usage?.output_tokens ?? null,
      }).changes;
    } catch (err) {
      // The SDK already retried what can be retried (429, 5xx, timeouts). A refused key will refuse every finding.
      refused ||= err instanceof AuthenticationError || err instanceof PermissionDeniedError;
      skipped.add((err as Error).name || "error");
    }
  });
  return { judged, skipped: [...skipped] };
}

/**
 * Judges every review that reports, one review at a time. Returns a function that stops listening,
 * or null when Jev is off. Never throws into the emitter.
 */
export function judgeFindingsOnOutcome(outcomes: EventEmitter, getDb: () => Database.Database, client: TypeSafeClient | null): (() => void) | null {
  if (!client) return null;
  let queue = Promise.resolve();
  const listener = (outcome: ReviewOutcome) => {
    if (outcome.status !== "reported") return;
    queue = queue.then(async () => {
      const start = Date.now();
      try {
        const result = await judgeReviewFindings(getDb(), client, outcome.reviewId);
        track("review", "jev.judged", { reviewId: outcome.reviewId, status: result.skipped.length ? "partial" : "ok", durationMs: Date.now() - start, payload: result });
      } catch (err) {
        track("review", "jev.judged", { reviewId: outcome.reviewId, status: "error", durationMs: Date.now() - start, payload: { error: (err as Error).message } });
      }
    });
  };
  outcomes.on("outcome", listener);
  return () => outcomes.off("outcome", listener);
}
