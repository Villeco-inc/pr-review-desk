import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { saveRunFindings } from "../services/finding-store";
import type { Finding, FindingRow } from "../../../shared/types";

const finding = (title: string): Finding => ({
  file: "src/a.ts",
  startLine: 1,
  endLine: 2,
  side: "RIGHT",
  severity: "medium",
  category: "bug",
  title,
  summary: "",
  background: "",
  problem: "",
  suggestedFix: "",
  suggestedComment: `comment for ${title}`,
  references: [],
});

let db: Database.Database;
const rows = () => db.prepare("SELECT * FROM findings WHERE review_id = 'r' ORDER BY ord").all() as FindingRow[];
const byTitle = (t: string) => rows().find((r) => r.title === t)!;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  saveRunFindings(db, { reviewId: "r", runId: "run1", mode: "full", findings: ["untouched", "posted", "dismissed", "edited"].map(finding), verdicts: [] });
  db.prepare("UPDATE findings SET state = 'posted', comment_url = 'https://x' WHERE title = 'posted'").run();
  db.prepare("UPDATE findings SET state = 'dismissed' WHERE title = 'dismissed'").run();
  db.prepare("UPDATE findings SET draft_comment = 'my words' WHERE title = 'edited'").run();
});

describe("saveRunFindings", () => {
  it("records the run on each finding", () => {
    expect(rows().map((r) => r.run_id)).toEqual(["run1", "run1", "run1", "run1"]);
    expect(rows().every((r) => r.created_at !== null)).toBe(true);
  });

  it("on a full run, replaces only the open findings nobody touched", () => {
    saveRunFindings(db, { reviewId: "r", runId: "run2", mode: "full", findings: [finding("fresh")], verdicts: [] });
    expect(rows().map((r) => r.title)).toEqual(["posted", "dismissed", "edited", "fresh"]);
    expect(byTitle("posted").state).toBe("posted");
    expect(byTitle("edited").draft_comment).toBe("my words");
    expect(byTitle("fresh").run_id).toBe("run2");
  });

  it("on a follow-up run, keeps every earlier finding and applies the verdicts", () => {
    const ids = Object.fromEntries(rows().map((r) => [r.title, r.id]));
    saveRunFindings(db, {
      reviewId: "r",
      runId: "run2",
      mode: "followup",
      findings: [finding("new in the push")],
      verdicts: [
        { id: ids.untouched, status: "resolved", note: "fixed in abc" },
        { id: ids.posted, status: "resolved", note: "fixed too" },
        { id: ids.edited, status: "still_present", note: "" },
        { id: "not-ours", status: "resolved", note: "" },
      ],
    });
    expect(rows()).toHaveLength(5);
    expect(byTitle("untouched")).toMatchObject({ state: "resolved", followup_status: "resolved", followup_note: "fixed in abc" });
    expect(byTitle("posted")).toMatchObject({ state: "posted", followup_status: "resolved" });
    expect(byTitle("edited")).toMatchObject({ state: "open", followup_status: "still_present" });
    expect(byTitle("dismissed").followup_status).toBeNull();
  });

  it("reading a follow-up run's report again does not double its findings", () => {
    const again = { reviewId: "r", runId: "run2", mode: "followup" as const, findings: [finding("new in the push")], verdicts: [] };
    saveRunFindings(db, again);
    saveRunFindings(db, again);
    expect(rows().filter((r) => r.title === "new in the push")).toHaveLength(1);
    expect(rows()).toHaveLength(5);
  });
});
