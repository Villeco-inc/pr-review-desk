import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { importDeadpoolVerdicts, parseDeadpoolVerdict, readDeadpoolVerdicts } from "../services/deadpool-reviews";
import { saveRunFindings } from "../services/finding-store";
import { toFindingDto } from "../services/dto";
import type { FindingRow, ReviewRow } from "../../../shared/types";

const verdictFile = (head: { sha: string; base: string; tour: number; verdict: string; date: string; branch?: string }, findings: string) => `---
ticket: VIL-5247
dev: Nightcrawler
branche: ${head.branch ?? "fix/VIL-5247-conteneur"}
base: ${head.base}
sha: ${head.sha}
tour: ${head.tour}
verdict: ${head.verdict}
date: ${head.date}
---

## Vérifications

- jest → 913 passed.

## Spec

Tenu : un AVAILABLE sans historique peut prendre la place à ramasser.

## Findings

${findings}

## Hors portée

- 1. **mineur** · \`src/neighbour.ts:3\` · Un défaut préexistant, hors du diff.
`;

// The shapes Deadpool actually wrote in ~/.cerebro/revues between 2026-10-20 and 2026-10-22.
const TOUR_ONE = `1. **élevé** · \`src/on-site.ts:168-171\` avec \`:181-186\` · Un IN_SERVICE lu depuis moins de 2 min passe en « waiting » et sort avant d'être groupé. Cas : ROAD_VR. · Correctif : un IN_SERVICE candidat retient les candidats à corriger.
2. **moyen · à trancher par David** · \`SKILL.md:31\` et \`references/scope.md:36\` · Le texte libre des autres tables part tel quel.
- mineur · src/compare.ts:65 · \`compare\` passe avant la garde (l. 74). Un lieu NULL plante.
3. **mineur (test manquant)** · \`references/scope.md:30\` promet que \`verify\` lit encore un vieux run ; aucun scénario ne le garde. Bloc à coller :
\`\`\`
- id: verify-old-run

  expect: verify reads it
\`\`\`

À savoir pour Vigie (pas un finding) : une puce faible arrive sans \`lastSeenEpoch\`.
Jugés et écartés :
- \`support/vraies-levees.ts:193\` — décalé avec le Δ de la minute d'envoi.`;

describe("parseDeadpoolVerdict", () => {
  const parsed = parseDeadpoolVerdict("VIL-5247/a.md", verdictFile({ sha: "abc1234", base: "e62bc65", tour: 1, verdict: "refuse", date: "2026-10-22T01:47:28Z" }, TOUR_ONE))!;

  it("reads the header Deadpool's script writes", () => {
    expect(parsed).toMatchObject({ ticket: "VIL-5247", dev: "Nightcrawler", branch: "fix/VIL-5247-conteneur", base: "e62bc65", sha: "abc1234", tour: 1, verdict: "refuse" });
    expect(parsed.spec).toBe("Tenu : un AVAILABLE sans historique peut prendre la place à ramasser.");
  });

  it("turns each finding line into a finding, and nothing else", () => {
    expect(parsed.findings.map((f) => [f.severity, f.file, f.startLine, f.endLine])).toEqual([
      ["high", "src/on-site.ts", 168, 171],
      ["medium", "SKILL.md", 31, 31],
      ["low", "src/compare.ts", 65, 65],
      ["low", "references/scope.md", 30, 30],
    ]);
  });

  it("splits the problem from the fix, and keeps the other places as references", () => {
    const [first] = parsed.findings;
    expect(first.title).toBe("Un IN_SERVICE lu depuis moins de 2 min passe en « waiting » et sort avant d'être groupé.");
    expect(first.problem).toBe("Un IN_SERVICE lu depuis moins de 2 min passe en « waiting » et sort avant d'être groupé. Cas : ROAD_VR.");
    expect(first.suggestedFix).toBe("un IN_SERVICE candidat retient les candidats à corriger.");
    expect(first.references).toEqual([{ file: "src/on-site.ts", startLine: 181, endLine: 186, note: "" }]);
    expect(first.category).toBe("Deadpool · tour 1");
    expect(first.background).toContain("Deadpool, tour 1 (refusé) · VIL-5247 · Nightcrawler · abc1234 sur e62bc65");
  });

  it("keeps what Deadpool wrote after the severity, and the code block of a finding", () => {
    expect(parsed.findings[1].summary).toContain("(à trancher par David)");
    expect(parsed.findings[2].title).toBe("`compare` passe avant la garde (l. 74).");
    expect(parsed.findings[3].problem).toContain("- id: verify-old-run");
    expect(parsed.findings[3].problem).not.toContain("À savoir pour Vigie");
  });

  it("reads no finding from « Aucun. » or from a file without a header", () => {
    expect(parseDeadpoolVerdict("x.md", verdictFile({ sha: "a", base: "b", tour: 2, verdict: "approuve", date: "d" }, "Aucun."))!.findings).toEqual([]);
    expect(parseDeadpoolVerdict("x.md", "## Findings\n\n1. **moyen** · `a.ts:1` · x")).toBeNull();
  });
});

describe("importDeadpoolVerdicts", () => {
  let root = "";
  let repo = "";
  let base = "";
  let first = "";
  let second = "";
  let db: Database.Database;
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deadpool-")));
    repo = path.join(root, "linea-inventories-api");
    fs.mkdirSync(repo);
    sh(repo, "init", "-q", "-b", "dev");
    sh(repo, "config", "user.email", "t@t");
    sh(repo, "config", "user.name", "t");
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src/on-site.ts"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "base");
    base = sh(repo, "rev-parse", "HEAD");
    sh(repo, "checkout", "-q", "-b", "fix/VIL-5247-conteneur");
    fs.writeFileSync(path.join(repo, "src/on-site.ts"), "one\ntwo\n");
    sh(repo, "commit", "-q", "-am", "tour 1");
    first = sh(repo, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "src/on-site.ts"), "one\ntwo\nthree\n");
    sh(repo, "commit", "-q", "-am", "tour 2");
    second = sh(repo, "rev-parse", "HEAD");
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  const repos = () => [{ label: "linea-inventories-api", path: repo }];
  const tourOne = () => parseDeadpoolVerdict("VIL-5247/t1.md", verdictFile({ sha: first, base, tour: 1, verdict: "refuse", date: "2026-10-22T01:47:28Z" }, TOUR_ONE))!;
  const tourTwo = () =>
    parseDeadpoolVerdict("VIL-5247/t2.md", verdictFile({ sha: second, base, tour: 2, verdict: "refuse", date: "2026-10-22T02:02:53Z" }, "1. **faible** · `src/on-site.ts:3` · Encore un défaut."))!;
  const findings = () => db.prepare("SELECT * FROM findings ORDER BY ord").all() as FindingRow[];
  const review = () => db.prepare("SELECT * FROM reviews").get() as ReviewRow;

  it("puts the findings on the local review of the branch, with the reviewed diff", async () => {
    const result = await importDeadpoolVerdicts(db, [tourOne()], repos());
    expect(result).toEqual({ findings: 4, skipped: [] });
    expect(review().id).toMatch(/^local\/linea-inventories-api-[0-9a-f]{10}#0$/);
    expect(review().status).toBe("reported");
    expect(review().title).toBe("Deadpool · VIL-5247 · Nightcrawler");
    expect(review().diff).toContain("+two");
    expect(findings().every((f) => f.source === "deadpool" && f.state === "open")).toBe(true);
    expect(toFindingDto(findings()[0], []).source).toBe("deadpool");
  });

  it("reads a verdict again without doubling it, and keeps what you did with a finding", async () => {
    await importDeadpoolVerdicts(db, [tourOne()], repos());
    db.prepare("UPDATE findings SET state = 'dismissed' WHERE id = ?").run(findings()[0].id);
    await importDeadpoolVerdicts(db, [tourOne()], repos());
    expect(findings()).toHaveLength(4);
    expect(findings()[0].state).toBe("dismissed");
  });

  it("marks the open findings of an earlier round resolved, and follows the latest commit", async () => {
    await importDeadpoolVerdicts(db, [tourOne()], repos());
    await importDeadpoolVerdicts(db, [tourOne(), tourTwo()], repos());
    const rows = findings();
    expect(rows.filter((f) => f.state === "open").map((f) => f.title)).toEqual(["Encore un défaut."]);
    expect(rows.filter((f) => f.state === "resolved")).toHaveLength(4);
    expect(rows[0].followup_note).toBe("Tour 2 de Deadpool (refusé) : il ne liste plus ce finding.");
    expect(review().diff).toContain("+three");
  });

  it("is never replaced by a full run of the Desk on the same branch", async () => {
    await importDeadpoolVerdicts(db, [tourOne()], repos());
    const reviewId = review().id;
    saveRunFindings(db, { reviewId, runId: "run1", mode: "full", findings: [], verdicts: [] });
    expect(findings()).toHaveLength(4);
  });

  it("leaves the Desk's own review of the branch as it is", async () => {
    await importDeadpoolVerdicts(db, [tourOne()], repos());
    db.prepare("UPDATE reviews SET snapshot = '{}', summary = 'desk', diff = 'desk diff'").run();
    await importDeadpoolVerdicts(db, [tourOne(), tourTwo()], repos());
    expect(review()).toMatchObject({ summary: "desk", diff: "desk diff" });
    expect(findings()).toHaveLength(5);
  });

  it("leaves out a verdict whose commit no local repo holds", async () => {
    const elsewhere = parseDeadpoolVerdict("X/t.md", verdictFile({ sha: "0".repeat(40), base, tour: 1, verdict: "refuse", date: "d", branch: "other" }, TOUR_ONE))!;
    expect(await importDeadpoolVerdicts(db, [elsewhere], repos())).toEqual({ findings: 0, skipped: ["X/t.md"] });
    expect(findings()).toHaveLength(0);
  });

  it("reads the ticket folders of the verdict directory", () => {
    const dir = path.join(root, "revues");
    fs.mkdirSync(path.join(dir, "VIL-5247"), { recursive: true });
    fs.writeFileSync(path.join(dir, "VIL-5247", "20261022-014728-Nightcrawler-tour1-refuse.md"), verdictFile({ sha: first, base, tour: 1, verdict: "refuse", date: "d" }, TOUR_ONE));
    fs.writeFileSync(path.join(dir, "VIL-5247", ".tmp.md"), "partial");
    expect(readDeadpoolVerdicts(dir).map((v) => v.fileName)).toEqual(["VIL-5247/20261022-014728-Nightcrawler-tour1-refuse.md"]);
  });
});
