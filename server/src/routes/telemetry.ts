import { Router } from "express";
import { getDb } from "../db/schema";
import { getTelemetryDb, track } from "../db/telemetry";

export const telemetryRouter = Router();

const MAX_UI_EVENTS_PER_POST = 200;

/** The client batches its events (screens, clicks, filters) and sends them here. */
telemetryRouter.post("/telemetry/events", (req, res) => {
  const { session, events } = req.body as { session?: string; events?: { name?: string; ts?: string; durationMs?: number; payload?: Record<string, unknown> }[] };
  const list = Array.isArray(events) ? events.slice(0, MAX_UI_EVENTS_PER_POST) : [];
  for (const e of list) {
    if (typeof e?.name !== "string") continue;
    track("ui", e.name, {
      session: typeof session === "string" ? session.slice(0, 64) : null,
      ts: typeof e.ts === "string" ? e.ts : undefined,
      durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
      payload: e.payload && typeof e.payload === "object" ? e.payload : {},
    });
  }
  res.status(204).end();
});

telemetryRouter.get("/telemetry/events", (req, res) => {
  const kind = String(req.query.kind ?? "");
  const q = String(req.query.q ?? "");
  const before = Number(req.query.before ?? 0);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (kind) {
    where.push("kind = ?");
    args.push(kind);
  }
  if (q) {
    where.push("(name LIKE ? OR payload LIKE ? OR review_id LIKE ? OR repo LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (before > 0) {
    where.push("id < ?");
    args.push(before);
  }
  const rows = getTelemetryDb()
    .prepare(`SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit) as Record<string, unknown>[];
  res.json(rows.map((r) => ({ ...r, payload: JSON.parse(String(r.payload || "{}")) })));
});

/** Review runs per day and per repo from the reviews database, event counts from telemetry. */
telemetryRouter.get("/telemetry/summary", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = getDb();
  const runColumns = `COUNT(*) AS runs,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
    ROUND(SUM(COALESCE(cost_usd, 0)), 4) AS cost,
    SUM(COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)) AS tokensIn,
    SUM(COALESCE(output_tokens, 0)) AS tokensOut,
    ROUND(AVG(duration_ms)) AS avgDurationMs`;
  const byDay = db
    .prepare(`SELECT substr(started_at, 1, 10) AS day, ${runColumns} FROM review_runs WHERE started_at >= ? GROUP BY day ORDER BY day DESC`)
    .all(since);
  const byRepo = db
    .prepare(
      `SELECT CASE WHEN instr(review_id, '#') > 0 THEN substr(review_id, 1, instr(review_id, '#') - 1) ELSE review_id END AS repo, ${runColumns}
       FROM review_runs WHERE started_at >= ? GROUP BY repo ORDER BY cost DESC`
    )
    .all(since);
  const byModel = db
    .prepare(`SELECT COALESCE(model, 'default') AS model, COALESCE(effort, '—') AS effort, ${runColumns} FROM review_runs WHERE started_at >= ? GROUP BY model, effort ORDER BY runs DESC`)
    .all(since);
  const totals = db.prepare(`SELECT ${runColumns} FROM review_runs WHERE started_at >= ?`).get(since);
  const events = getTelemetryDb()
    .prepare(
      `SELECT kind, COUNT(*) AS count, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, ROUND(AVG(duration_ms)) AS avgDurationMs
       FROM events WHERE ts >= ? GROUP BY kind ORDER BY count DESC`
    )
    .all(since);
  res.json({ days, since, totals, byDay, byRepo, byModel, events });
});
