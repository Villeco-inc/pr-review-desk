import { describe, expect, it } from "vitest";
import { MAX_DIFF_CHARS_PER_FILE, globToRegExp, omitReason, scopeDiff } from "../services/diff-scope";

const filePatch = (path: string, body: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

describe("omitReason", () => {
  it("leaves out lockfiles, generated output and data wherever they sit", () => {
    expect(omitReason("package-lock.json")).toBe("lockfile");
    expect(omitReason("apps/web/yarn.lock")).toBe("lockfile");
    expect(omitReason("src/__snapshots__/Card.test.tsx.snap")).toBe("generated");
    expect(omitReason("dist/app.js")).toBe("generated");
    expect(omitReason("lib/seeds/data/ecoles_quebec_meq.csv")).toBe("data");
  });

  it("keeps source, tests and docs by default", () => {
    expect(omitReason("app/models/job.rb")).toBeNull();
    expect(omitReason("spec/models/job_spec.rb")).toBeNull();
    expect(omitReason("docs/bi/regles-affaires.md")).toBeNull();
    expect(omitReason("src/distance.ts")).toBeNull();
  });

  it("applies extra patterns", () => {
    expect(omitReason("docs/bi/regles-affaires.md", ["docs/**"])).toBe("excluded by DIFF_EXCLUDE");
    expect(omitReason("app/models/job.rb", ["docs/**"])).toBeNull();
  });
});

describe("globToRegExp", () => {
  it("keeps * inside one folder and lets ** cross folders", () => {
    expect(globToRegExp("docs/*.md").test("docs/a.md")).toBe(true);
    expect(globToRegExp("docs/*.md").test("docs/x/a.md")).toBe(false);
    expect(globToRegExp("docs/**").test("docs/x/a.md")).toBe(true);
  });
});

describe("scopeDiff", () => {
  it("sends source, names what it left out, and cuts what is too long", () => {
    const long = "+" + "x".repeat(MAX_DIFF_CHARS_PER_FILE + 500);
    const diff = [filePatch("app/a.rb", "+a"), filePatch("Gemfile.lock", "+gem"), filePatch("app/big.rb", long)].join("\n");
    const scope = scopeDiff(diff, []);
    expect(scope.sentFiles).toBe(2);
    expect(scope.omitted).toEqual([expect.objectContaining({ path: "Gemfile.lock", reason: "lockfile" })]);
    expect(scope.truncated).toEqual([expect.objectContaining({ path: "app/big.rb", keptChars: MAX_DIFF_CHARS_PER_FILE })]);
    expect(scope.text).toContain("app/a.rb");
    expect(scope.text).not.toContain("+gem");
    expect(scope.text).toMatch(/\[truncated: \d+ more characters not shown\]/);
  });
});
