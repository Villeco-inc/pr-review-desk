// Telemetry lives in its own SQLite file, data/telemetry.db, so the reviews database stays small and
// telemetry can be emptied or deleted on its own. Nothing is purged automatically.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data", "telemetry.db");
const MAX_PAYLOAD_CHARS = 20_000;

let instance: Database.Database | null = null;
let insert: Database.Statement | null = null;

export function getTelemetryDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT,
      duration_ms INTEGER,
      review_id TEXT,
      run_id TEXT,
      repo TEXT,
      session TEXT,
      payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_by_ts ON events (ts);
    CREATE INDEX IF NOT EXISTS events_by_kind ON events (kind, ts);
    CREATE INDEX IF NOT EXISTS events_by_review ON events (review_id, ts);
  `);
  return instance;
}

export type EventKind = "http" | "gh" | "git" | "claude" | "review" | "finding" | "ui";

export interface TrackFields {
  status?: string;
  durationMs?: number;
  reviewId?: string | null;
  runId?: string | null;
  repo?: string | null;
  session?: string | null;
  ts?: string;
  payload?: Record<string, unknown>;
}

/** Records one event. Never throws: telemetry must not break a request or a review. */
export function track(kind: EventKind, name: string, fields: TrackFields = {}): void {
  try {
    const db = getTelemetryDb();
    insert ??= db.prepare(
      `INSERT INTO events (ts, kind, name, status, duration_ms, review_id, run_id, repo, session, payload)
       VALUES (@ts, @kind, @name, @status, @duration_ms, @review_id, @run_id, @repo, @session, @payload)`
    );
    let payload = JSON.stringify(fields.payload ?? {});
    if (payload.length > MAX_PAYLOAD_CHARS) payload = JSON.stringify({ truncated: true, preview: payload.slice(0, MAX_PAYLOAD_CHARS) });
    insert.run({
      ts: fields.ts ?? new Date().toISOString(),
      kind,
      name: name.slice(0, 300),
      status: fields.status ?? null,
      duration_ms: fields.durationMs === undefined ? null : Math.round(fields.durationMs),
      review_id: fields.reviewId ?? null,
      run_id: fields.runId ?? null,
      repo: fields.repo ?? null,
      session: fields.session ?? null,
      payload,
    });
  } catch (err) {
    console.error("[telemetry] could not record event:", (err as Error).message);
  }
}

/** Times an async call and records it whether it succeeds or throws. */
export async function timed<T>(kind: EventKind, name: string, fields: TrackFields, fn: () => Promise<T>, describe?: (result: T) => Record<string, unknown>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    track(kind, name, { ...fields, status: "ok", durationMs: Date.now() - start, payload: { ...fields.payload, ...describe?.(result) } });
    return result;
  } catch (err) {
    const e = err as { code?: unknown; message?: string };
    track(kind, name, {
      ...fields,
      status: "error",
      durationMs: Date.now() - start,
      payload: { ...fields.payload, error: String(e.message ?? err).slice(0, 2000), code: e.code ?? null },
    });
    throw err;
  }
}
