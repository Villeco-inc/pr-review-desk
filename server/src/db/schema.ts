import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data", "reviews.db");

let instance: Database.Database | null = null;

export function migrate(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      diff TEXT NOT NULL DEFAULT '',
      snapshot TEXT NOT NULL DEFAULT '{}',
      skills TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      file TEXT NOT NULL DEFAULT '',
      start_line INTEGER,
      end_line INTEGER,
      side TEXT NOT NULL DEFAULT 'RIGHT',
      severity TEXT NOT NULL DEFAULT 'medium',
      category TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      background TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      suggested_fix TEXT NOT NULL DEFAULT '',
      suggested_comment TEXT NOT NULL DEFAULT '',
      draft_comment TEXT,
      state TEXT NOT NULL DEFAULT 'open',
      comment_url TEXT,
      posted_at TEXT,
      posted_as TEXT NOT NULL DEFAULT 'comment',
      references_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS findings_by_review ON findings (review_id);

    CREATE TABLE IF NOT EXISTS review_runs (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      model TEXT,
      effort TEXT,
      max_turns INTEGER,
      skills TEXT NOT NULL DEFAULT '[]',
      prompt_chars INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      num_turns INTEGER,
      duration_ms INTEGER,
      cost_usd REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS runs_by_review ON review_runs (review_id, started_at);

    CREATE TABLE IF NOT EXISTS pr_cache (
      repo TEXT PRIMARY KEY,
      prs TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  addMissingColumns(database, "review_runs", {
    effort_level: "TEXT",
    diff_files: "INTEGER",
    sent_files: "INTEGER",
    omitted_files: "TEXT NOT NULL DEFAULT '[]'",
    truncated_files: "TEXT NOT NULL DEFAULT '[]'",
    // The commit the run read, and for a follow-up run the commit it started from.
    head_sha: "TEXT",
    base_sha: "TEXT",
    mode: "TEXT NOT NULL DEFAULT 'full'",
    // What the reviewer told the agent for this run, verbatim.
    instructions: "TEXT",
  });
  addMissingColumns(database, "findings", {
    run_id: "TEXT",
    followup_status: "TEXT",
    followup_note: "TEXT",
    created_at: "TEXT",
    // NULL for the Desk's own runs; 'deadpool' for findings imported from a Deadpool verdict file.
    source: "TEXT",
  });

  // Notification history: review outcomes and the GitHub events the poller saw. target is a JSON ReviewTarget.
  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tag TEXT NOT NULL,
      url TEXT,
      target TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (read_at);
  `);
}

/** CREATE TABLE IF NOT EXISTS leaves existing tables alone: columns added later go through here. Additive only. */
function addMissingColumns(database: Database.Database, table: string, columns: Record<string, string>): void {
  const existing = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/**
 * Which run produced a finding, and Jev's raw answers about it (probabilities, not verdicts: thresholds are
 * applied when reading, so they can be tuned on our data). Additive: a verdict lives in its own table.
 */
export function migrateFindingQuality(database: Database.Database): void {
  addMissingColumns(database, "findings", { run_id: "TEXT" });
  database.exec(`
    CREATE TABLE IF NOT EXISTS finding_judgments (
      finding_id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      judged_at TEXT NOT NULL,
      model TEXT,
      nit REAL,
      holds REAL,
      severity_score REAL,
      severity_confidence REAL,
      severity_probabilities TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER
    );
    CREATE INDEX IF NOT EXISTS judgments_by_review ON finding_judgments (review_id);
  `);
}

export function getDb(): Database.Database {
  if (instance) return instance;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  instance = new Database(DB_PATH);
  migrate(instance);
  migrateFindingQuality(instance);
  return instance;
}
