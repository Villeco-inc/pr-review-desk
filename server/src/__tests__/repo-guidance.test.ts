import { describe, expect, it } from "vitest";
import { assembleGuidance, atReferences, collectRepoGuidance, guidanceCandidates } from "../services/repo-guidance";

describe("guidanceCandidates", () => {
  it("lists the root files first, then those of every folder the diff touches, each once", () => {
    expect(guidanceCandidates(["README.md", "server/src/a.ts", "server/src/b.ts", "client/x.tsx"])).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "server/CLAUDE.md",
      "server/AGENTS.md",
      "server/src/CLAUDE.md",
      "server/src/AGENTS.md",
      "client/CLAUDE.md",
      "client/AGENTS.md",
    ]);
  });
});

describe("atReferences", () => {
  it("reads @file lines relative to the file that names them", () => {
    expect(atReferences("@AGENTS.md\nSee also @docs/rules.md for more.", "server/CLAUDE.md")).toEqual(["server/AGENTS.md", "server/docs/rules.md"]);
    expect(atReferences("@AGENTS.md", "CLAUDE.md")).toEqual(["AGENTS.md"]);
  });

  it("ignores mentions and emails that are not files, and paths leaving the repository", () => {
    expect(atReferences("Ask @david or mail a@b.com; @../secret.md; `@types/node`", "CLAUDE.md")).toEqual([]);
  });
});

describe("assembleGuidance", () => {
  it("keeps everything under the cap, each file under its path", () => {
    const out = assembleGuidance([{ path: "CLAUDE.md", content: "Use tabs." }], 1000);
    expect(out.cut).toBe(false);
    expect(out.text).toContain("### CLAUDE.md\nUse tabs.");
  });

  it("cuts at the cap and says how much it had", () => {
    const out = assembleGuidance([{ path: "CLAUDE.md", content: "x".repeat(50) }, { path: "AGENTS.md", content: "y".repeat(50) }], 60);
    expect(out.cut).toBe(true);
    expect(out.text.length).toBe(60);
    expect(out.totalChars).toBeGreaterThan(100);
  });
});

describe("collectRepoGuidance", () => {
  it("fetches the candidates that exist, then the files they point to, once each", async () => {
    const files: Record<string, string> = { "CLAUDE.md": "@AGENTS.md", "AGENTS.md": "Root rules", "server/CLAUDE.md": "@AGENTS.md\n@../AGENTS.md" };
    const asked: string[] = [];
    const fetchFile = async (path: string) => {
      asked.push(path);
      return files[path] ?? null;
    };
    const found = await collectRepoGuidance(["server/a.ts"], fetchFile);
    expect(found.map((f) => f.path)).toEqual(["CLAUDE.md", "AGENTS.md", "server/CLAUDE.md"]);
    expect(asked.filter((p) => p === "AGENTS.md")).toHaveLength(1);
  });
});
