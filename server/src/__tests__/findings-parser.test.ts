import { describe, expect, it } from "vitest";
import { normalizeFinding, parseReport, repairJson } from "../services/findings-parser";

describe("parseReport", () => {
  it("parses a valid report with camelCase fields", () => {
    const raw = JSON.stringify({
      summary: "overall looks fine",
      findings: [
        {
          file: "src/index.ts",
          startLine: 10,
          endLine: 12,
          side: "RIGHT",
          severity: "high",
          category: "bug",
          title: "off by one",
          summary: "loop goes one too far",
          background: "",
          problem: "index overflow",
          suggestedFix: "use < instead of <=",
          suggestedComment: "consider using < here",
          references: [],
        },
      ],
    });

    const result = parseReport(raw);

    expect(result.error).toBeNull();
    expect(result.report?.summary).toBe("overall looks fine");
    expect(result.report?.findings).toHaveLength(1);
    expect(result.report?.findings[0]).toMatchObject({
      file: "src/index.ts",
      startLine: 10,
      endLine: 12,
      severity: "high",
      title: "off by one",
    });
  });

  it("parses a valid report with snake_case fields", () => {
    const raw = JSON.stringify({
      summary: "ok",
      findings: [
        {
          file: "src/foo.ts",
          start_line: 3,
          end_line: 5,
          suggested_fix: "do the thing",
          suggested_comment: "please fix",
          title: "issue",
        },
      ],
    });

    const result = parseReport(raw);

    expect(result.error).toBeNull();
    expect(result.report?.findings[0]).toMatchObject({
      file: "src/foo.ts",
      startLine: 3,
      endLine: 5,
      suggestedFix: "do the thing",
      suggestedComment: "please fix",
    });
  });

  it("accepts a bare array of findings", () => {
    const raw = JSON.stringify([{ file: "a.ts", title: "t" }]);

    const result = parseReport(raw);

    expect(result.error).toBeNull();
    expect(result.report?.summary).toBe("");
    expect(result.report?.findings).toHaveLength(1);
  });

  it("accepts findings nested under issues or comments keys", () => {
    const raw = JSON.stringify({ issues: [{ file: "a.ts", title: "t" }] });
    const result = parseReport(raw);
    expect(result.report?.findings).toHaveLength(1);
  });

  it("drops findings missing required fields and records a warning", () => {
    const raw = JSON.stringify({
      findings: [
        { file: "a.ts", title: "valid" },
        { title: "missing file" },
        { file: "b.ts" },
      ],
    });

    const result = parseReport(raw);

    expect(result.report?.findings).toHaveLength(1);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0].reason).toMatch(/missing "file"/);
    expect(result.warnings[1].reason).toMatch(/missing "title"/);
  });

  it("returns an error for invalid JSON", () => {
    const result = parseReport("{not json");
    expect(result.report).toBeNull();
    expect(result.error).toMatch(/invalid JSON/);
  });

  it("returns an error when there is no findings array", () => {
    const result = parseReport(JSON.stringify({ summary: "hi" }));
    expect(result.report).toBeNull();
    expect(result.error).toMatch(/findings/);
  });

  it("normalizes severity aliases", () => {
    const cases: Array<[string, string]> = [
      ["critical", "blocker"],
      ["major", "high"],
      ["warning", "medium"],
      ["minor", "low"],
      ["info", "nit"],
      ["bogus", "medium"],
    ];

    for (const [input, expected] of cases) {
      const { finding } = normalizeFinding({ file: "a.ts", title: "t", severity: input }, 0);
      expect(finding?.severity).toBe(expected);
    }
  });

  it("defaults side to RIGHT and validates LEFT", () => {
    const { finding: right } = normalizeFinding({ file: "a.ts", title: "t" }, 0);
    expect(right?.side).toBe("RIGHT");

    const { finding: left } = normalizeFinding({ file: "a.ts", title: "t", side: "left" }, 0);
    expect(left?.side).toBe("LEFT");

    const { finding: bogus } = normalizeFinding({ file: "a.ts", title: "t", side: "UP" }, 0);
    expect(bogus?.side).toBe("RIGHT");
  });

  it("parses a references array with snake_case fields", () => {
    const { finding } = normalizeFinding(
      {
        file: "a.ts",
        title: "t",
        references: [{ file: "b.ts", start_line: 1, end_line: 2, note: "related" }],
      },
      0
    );

    expect(finding?.references).toEqual([{ file: "b.ts", startLine: 1, endLine: 2, note: "related" }]);
  });
});

describe("repairJson", () => {
  // The exact shape that failed a real review: plain quotes around a value inside French text.
  const broken =
    '{"summary": "ok", "findings": [{"file": "a.tsx", "startLine": 3, "severity": "medium", "title": "La carte affiche « 1 icône + "+1" » au lieu des 2", "problem": "x"}]}';

  it("escapes quotes that do not end the string", () => {
    expect(() => JSON.parse(broken)).toThrow();
    const parsed = JSON.parse(repairJson(broken));
    expect(parsed.findings[0].title).toBe('La carte affiche « 1 icône + "+1" » au lieu des 2');
  });

  it("escapes raw line breaks inside strings", () => {
    const raw = '{"summary": "two\nlines"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(JSON.parse(repairJson(raw)).summary).toBe("two\nlines");
  });

  it("leaves valid JSON untouched", () => {
    const valid = '{"a": "say \\"hi\\"", "b": ["x", "y"], "c": {"d": 1}}';
    expect(repairJson(valid)).toBe(valid);
  });

  it("lets parseReport recover the report and says so", () => {
    const r = parseReport(broken);
    expect(r.error).toBeNull();
    expect(r.report?.findings).toHaveLength(1);
    expect(r.warnings[0].reason).toMatch(/escaped/);
  });
});
