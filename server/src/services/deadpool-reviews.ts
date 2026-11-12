// Shows Deadpool's reviews in the Desk. Deadpool (the reviewer of the Cerebro dev team) writes one
// verdict file per review round in ~/.cerebro/revues/<ticket>/; each file becomes the findings of the
// local review of its branch, next to the Desk's own. The files are only read, never written.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Finding, Reference, Severity } from "../../../shared/types";
import { getCommitRangeDiff, hasCommit, localRepoIdentity, type LocalRepo } from "./local-git";
import { reviewId } from "./review-engine";

export interface DeadpoolVerdict {
  fileName: string;
  ticket: string;
  dev: string;
  branch: string;
  base: string;
  sha: string;
  tour: number;
  verdict: string;
  date: string;
  spec: string;
  findings: Finding[];
}

const VERDICT_LABEL: Record<string, string> = { approuve: "approuvé", refuse: "refusé", "gates-rouges": "gates rouges" };

const SEVERITY_WORDS: [RegExp, Severity][] = [
  [/^bloquant/i, "blocker"],
  [/^(majeur|élevé|eleve)/i, "high"],
  [/^moyen/i, "medium"],
  [/^(mineur|faible)/i, "low"],
];

function severityOf(word: string): Severity | null {
  return SEVERITY_WORDS.find(([re]) => re.test(word))?.[1] ?? null;
}

export const verdictLabel = (verdict: string) => VERDICT_LABEL[verdict] ?? verdict;

function frontMatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  return Object.fromEntries(
    m[1]
      .split("\n")
      .map((line) => line.match(/^([\w-]+):\s*(.*)$/))
      .filter((x): x is RegExpMatchArray => x !== null)
      .map((x) => [x[1], x[2].trim()])
  );
}

function section(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

// A finding line: "1. **moyen** · `file:12-14` · …" or "- mineur · file:12 · …", the severity first.
const ITEM_START = /^(?:\d+\.|[-*])\s+/;
// No \b: in a JavaScript regex, the é that ends « élevé » is not a word character.
const SEVERITY_START = /^(?:\*\*)?(bloquant|majeur|élevé|eleve|moyen|mineur|faible)(?=[\s*·(:]|$)/i;

/** The finding items of a "## Findings" section, each with its continuation lines and code blocks. A blank line ends an item. */
function findingItems(body: string): string[] {
  const items: string[][] = [];
  let open = false;
  let inFence = false;
  for (const line of body.split("\n")) {
    const fence = line.trimStart().startsWith("```");
    if (!inFence && ITEM_START.test(line)) {
      const rest = line.replace(ITEM_START, "");
      open = SEVERITY_START.test(rest);
      if (open) items.push([rest]);
    } else if (open && (inFence || fence || line.trim() !== "")) {
      items[items.length - 1].push(line);
    } else if (!inFence) {
      open = false;
    }
    if (fence) inFence = !inFence;
  }
  return items.map((lines) => lines.join("\n"));
}

const LOCATION = /`?([\w.@/-]*[\w-]+\.[\w]+)(?::(\d+)(?:-(\d+))?)?`?/;
const SAME_FILE_LINES = /`:(\d+)(?:-(\d+))?`/g;
const CODE_LOCATIONS = /`([\w.@/-]*[\w-]+\.[\w]+):(\d+)(?:-(\d+))?`/g;

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // A sentence ends before a capital: « (l. 74) » and « rév. 3 » are abbreviations, not ends.
  const end = flat.search(/[.!?](\s+[A-ZÀ-Ý«`]|$)/);
  const sentence = end > 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

export function parseFindingItem(item: string, context: { background: string; category: string }): Finding | null {
  let head = item;
  let severityWord = "";
  let qualifier = "";
  const bold = head.match(/^\*\*(.+?)\*\*\s*(?:·\s*)?/);
  if (bold) {
    severityWord = bold[1].split(/[\s·(]/)[0];
    qualifier = bold[1].slice(severityWord.length).replace(/^[\s·]+/, "").trim();
    head = head.slice(bold[0].length);
  } else {
    const plain = head.match(/^(\S+)\s*·\s*/);
    if (!plain) return null;
    severityWord = plain[1];
    head = head.slice(plain[0].length);
  }
  const severity = severityOf(severityWord);
  if (!severity) return null;

  const parts = head.split(/\s+·\s+/);
  const where = parts[0] ?? "";
  const location = /^[`\w./@-]/.test(where) ? where.match(LOCATION) : null;
  const file = location?.[1] ?? "";
  const startLine = location?.[2] ? Number(location[2]) : null;
  const endLine = location?.[3] ? Number(location[3]) : startLine;

  const references: Reference[] = [];
  if (location) {
    for (const m of where.matchAll(SAME_FILE_LINES)) {
      references.push({ file, startLine: Number(m[1]), endLine: m[2] ? Number(m[2]) : Number(m[1]), note: "" });
    }
    for (const m of where.matchAll(CODE_LOCATIONS)) {
      if (m.index === where.indexOf(location[0])) continue;
      references.push({ file: m[1], startLine: Number(m[2]), endLine: m[3] ? Number(m[3]) : Number(m[2]), note: "" });
    }
  }

  // A finding written without « · » after its place (« `scope.md:30` promet que … ») keeps that text as its problem.
  const body = location && parts.length > 1 ? parts.slice(1) : parts;
  const fixAt = body.findIndex((p) => /^(Correctif|Correction|Fix)\s*:/i.test(p.trim()));
  const problem = (fixAt < 0 ? body : body.slice(0, fixAt)).join(" · ").trim();
  const suggestedFix = fixAt < 0 ? "" : body.slice(fixAt).join(" · ").replace(/^(Correctif|Correction|Fix)\s*:\s*/i, "").trim();
  const title = firstSentence(problem) || firstSentence(where);

  return {
    file,
    startLine,
    endLine,
    side: "RIGHT",
    severity,
    category: context.category,
    title,
    summary: qualifier ? `${title} (${qualifier})` : title,
    background: qualifier ? `${context.background}\n\nGravité notée par Deadpool : ${severityWord} · ${qualifier}.` : context.background,
    problem,
    suggestedFix,
    suggestedComment: suggestedFix ? `${problem}\n\nCorrectif : ${suggestedFix}` : problem,
    references,
  };
}

export function parseDeadpoolVerdict(fileName: string, text: string): DeadpoolVerdict | null {
  const head = frontMatter(text);
  const { ticket, dev, branche, base, sha, tour, verdict, date } = head;
  if (!ticket || !branche || !base || !sha || !verdict) return null;
  const round = Number(tour) || 1;
  const background = `Deadpool, tour ${round} (${verdictLabel(verdict)}) · ${ticket} · ${dev ?? "?"} · ${sha.slice(0, 7)} sur ${base}${date ? ` · ${date}` : ""}`;
  const category = `Deadpool · tour ${round}`;
  const findings = findingItems(section(text, "Findings"))
    .map((item) => parseFindingItem(item, { background, category }))
    .filter((f): f is Finding => f !== null);
  return {
    fileName,
    ticket,
    dev: dev ?? "",
    branch: branche,
    base,
    sha,
    tour: round,
    verdict,
    date: date ?? "",
    spec: section(text, "Spec"),
    findings,
  };
}

/** Every verdict file under the folder, one level of ticket folders deep. Unreadable ones are left out. */
export function readDeadpoolVerdicts(dir: string): DeadpoolVerdict[] {
  let tickets: fs.Dirent[];
  try {
    tickets = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const verdicts: DeadpoolVerdict[] = [];
  for (const ticket of tickets) {
    if (!ticket.isDirectory() || ticket.name.startsWith(".")) continue;
    const ticketDir = path.join(dir, ticket.name);
    for (const name of fs.readdirSync(ticketDir)) {
      if (!name.endsWith(".md") || name.startsWith(".")) continue;
      try {
        const parsed = parseDeadpoolVerdict(`${ticket.name}/${name}`, fs.readFileSync(path.join(ticketDir, name), "utf8"));
        if (parsed) verdicts.push(parsed);
      } catch {
        // A file being written or removed is read again on the next pass.
      }
    }
  }
  return verdicts;
}

export const deadpoolReviewsDir = () => process.env.DEADPOOL_REVIEWS_DIR || path.join(os.homedir(), ".cerebro", "revues");

const repoOfSha = new Map<string, string>();
const unplaced = new Set<string>();

async function findRepo(repos: LocalRepo[], sha: string): Promise<LocalRepo | null> {
  const known = repoOfSha.get(sha);
  if (known) return repos.find((r) => r.label === known) ?? null;
  for (const repo of repos) {
    if (await hasCommit(repo.path, sha)) {
      repoOfSha.set(sha, repo.label);
      return repo;
    }
  }
  return null;
}

/**
 * Puts each verdict's findings on the local review of its branch, in the repo whose history holds the
 * reviewed commit. Idempotent: a finding keeps its id from one pass to the next, so what you did with it
 * (posted, dismissed, edited) stays. A later round supersedes the earlier ones, as Deadpool re-lists
 * every finding that still holds: the open findings of earlier rounds are marked resolved.
 */
export async function importDeadpoolVerdicts(db: Database.Database, verdicts: DeadpoolVerdict[], repos: LocalRepo[]): Promise<{ findings: number; skipped: string[] }> {
  const byBranch = new Map<string, DeadpoolVerdict[]>();
  for (const v of verdicts) byBranch.set(v.branch, [...(byBranch.get(v.branch) ?? []), v]);

  let imported = 0;
  const skipped: string[] = [];
  for (const [branch, rounds] of byBranch) {
    rounds.sort((a, b) => a.date.localeCompare(b.date) || a.fileName.localeCompare(b.fileName));
    const latest = rounds[rounds.length - 1];
    const repo = await findRepo(repos, latest.sha);
    if (!repo) {
      skipped.push(...rounds.map((r) => r.fileName));
      continue;
    }

    const { repo: reviewRepo, number } = localRepoIdentity(repo.label, branch);
    const id = reviewId(reviewRepo, number);
    await upsertReview(db, { id, repo: reviewRepo, number, repoPath: repo.path, branch, latest });

    const insert = db.prepare(
      `INSERT OR IGNORE INTO findings (
        id, review_id, run_id, created_at, ord, file, start_line, end_line, side, severity, category, title,
        summary, background, problem, suggested_fix, suggested_comment, draft_comment,
        state, comment_url, posted_at, posted_as, references_json, source
      ) VALUES (
        @id, @review_id, NULL, @created_at, @ord, @file, @start_line, @end_line, @side, @severity, @category, @title,
        @summary, @background, @problem, @suggested_fix, @suggested_comment, @suggested_comment,
        'open', NULL, NULL, 'comment', @references_json, 'deadpool'
      )`
    );
    const supersede = db.prepare(
      `UPDATE findings SET state = 'resolved', followup_status = 'resolved', followup_note = @note
       WHERE id = @id AND state = 'open' AND followup_status IS NULL`
    );
    db.transaction(() => {
      const { next } = db.prepare("SELECT COALESCE(MAX(ord) + 1, 0) AS next FROM findings WHERE review_id = ?").get(id) as { next: number };
      let ord = next;
      for (const round of rounds) {
        round.findings.forEach((f, i) => {
          const findingId = `deadpool:${round.fileName}#${i + 1}`;
          const added = insert.run({
            id: findingId,
            review_id: id,
            created_at: round.date || new Date().toISOString(),
            ord,
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
            references_json: JSON.stringify(f.references),
          });
          if (added.changes > 0) {
            ord += 1;
            imported += 1;
          }
          if (round !== latest) {
            supersede.run({ id: findingId, note: `Tour ${latest.tour} de Deadpool (${verdictLabel(latest.verdict)}) : il ne liste plus ce finding.` });
          }
        });
      }
    })();
  }
  return { findings: imported, skipped };
}

async function upsertReview(
  db: Database.Database,
  input: { id: string; repo: string; number: number; repoPath: string; branch: string; latest: DeadpoolVerdict }
): Promise<void> {
  const { id, repo, number, repoPath, branch, latest } = input;
  const existing = db.prepare("SELECT snapshot FROM reviews WHERE id = ?").get(id) as { snapshot: string } | undefined;
  let snapshot: { source?: string; headRefOid?: string } = {};
  try {
    snapshot = JSON.parse(existing?.snapshot || "{}");
  } catch {}
  // The Desk's own review of the branch keeps its diff and summary; Deadpool only adds findings to it.
  if (existing && (snapshot.source !== "deadpool" || snapshot.headRefOid === latest.sha)) return;

  const diff = await getCommitRangeDiff(repoPath, latest.base, latest.sha).catch(() => "");
  const title = `Deadpool · ${latest.ticket} · ${latest.dev}`;
  const summary = [`Tour ${latest.tour} de Deadpool : ${verdictLabel(latest.verdict)} (${latest.sha.slice(0, 7)} sur ${latest.base}).`, latest.spec].filter(Boolean).join("\n\n");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO reviews (id, repo, number, title, status, summary, error, diff, snapshot, skills, created_at, updated_at)
     VALUES (@id, @repo, @number, @title, 'reported', @summary, NULL, @diff, @snapshot, '[]', @now, @now)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, diff = excluded.diff,
       snapshot = excluded.snapshot, updated_at = excluded.updated_at`
  ).run({
    id,
    repo,
    number,
    title,
    summary,
    diff,
    snapshot: JSON.stringify({
      source: "deadpool",
      title,
      body: "",
      author: { login: latest.dev },
      state: "open",
      isDraft: false,
      baseRefName: latest.base,
      headRefName: branch,
      headRefOid: latest.sha,
      comments: [],
      files: [],
    }),
    now,
  });
}

/** Reads the verdict folder now and every 30 s, while it exists. */
export function startDeadpoolImport(getDb: () => Database.Database, repos: () => LocalRepo[]): void {
  const dir = deadpoolReviewsDir();
  const pass = async () => {
    if (!fs.existsSync(dir)) return;
    try {
      const { findings, skipped } = await importDeadpoolVerdicts(getDb(), readDeadpoolVerdicts(dir), repos());
      if (findings > 0) console.log(`[deadpool] ${findings} new finding(s) from ${dir}`);
      const fresh = skipped.filter((f) => !unplaced.has(f));
      if (fresh.length > 0) console.log(`[deadpool] no local repo holds the reviewed commit of: ${fresh.join(", ")}`);
      fresh.forEach((f) => unplaced.add(f));
    } catch (err) {
      console.warn(`[deadpool] import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  void pass();
  setInterval(() => void pass(), 30_000).unref();
}
