import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { isRepoName, parseRepoList, saveSelectedRepos, scopeOf, selectedRepos } from "../services/repo-selection";

const dirs: string[] = [];

function openDb(file = ":memory:"): Database.Database {
  const db = new Database(file);
  migrate(db);
  return db;
}

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-repos-"));
  dirs.push(dir);
  return path.join(dir, "reviews.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("selected repositories", () => {
  it("falls back to REPOS from .env while nothing was picked", () => {
    expect(selectedRepos(openDb(), " Villeco-inc/villeco, Villeco-inc/linea-web ,")).toEqual(["Villeco-inc/villeco", "Villeco-inc/linea-web"]);
  });

  it("is empty with neither a pick nor REPOS, which is what opens the picker", () => {
    expect(selectedRepos(openDb(), undefined)).toEqual([]);
    expect(selectedRepos(openDb(), "")).toEqual([]);
  });

  it("prefers the picked repositories over REPOS once a pick is saved", () => {
    const db = openDb();
    saveSelectedRepos(db, ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
    expect(selectedRepos(db, "Villeco-inc/villeco")).toEqual(["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
  });

  it("drops a repository that was unticked", () => {
    const db = openDb();
    saveSelectedRepos(db, ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
    saveSelectedRepos(db, ["Villeco-inc/linea-web"]);
    expect(selectedRepos(db, undefined)).toEqual(["Villeco-inc/linea-web"]);
  });

  it("tells which repositories a pick added to the previous one", () => {
    const db = openDb();
    expect(saveSelectedRepos(db, ["Villeco-inc/linea-web"])).toEqual(["Villeco-inc/linea-web"]);
    expect(saveSelectedRepos(db, ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile", "Villeco-inc/linea-mobile"])).toEqual(["Villeco-inc/linea-mobile"]);
    expect(saveSelectedRepos(db, ["Villeco-inc/linea-mobile"])).toEqual([]);
  });

  it("reads 'all' as the whole selection and a selected repository as itself", () => {
    const selection = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];
    expect(scopeOf("all", selection)).toEqual(selection);
    expect(scopeOf("Villeco-inc/linea-mobile", selection)).toEqual(["Villeco-inc/linea-mobile"]);
  });

  it("refuses what is not selected, whatever it looks like", () => {
    const selection = ["Villeco-inc/linea-web"];
    expect(scopeOf("Villeco-inc/linea-mobile", selection)).toBeNull();
    expect(scopeOf("--help", selection)).toBeNull();
    expect(scopeOf("org:Villeco-inc", selection)).toBeNull();
    expect(scopeOf("", selection)).toBeNull();
  });

  it("keeps only valid repositories from REPOS, once each whatever their case, and says what it ignored", () => {
    expect(parseRepoList(" Villeco-inc/villeco, --help, all, villeco-inc/Villeco ,Villeco-inc/linea-web")).toEqual({
      repos: ["Villeco-inc/villeco", "Villeco-inc/linea-web"],
      ignored: ["--help", "all"],
    });
    expect(selectedRepos(openDb(), "--help,Villeco-inc/villeco,villeco-inc/VILLECO")).toEqual(["Villeco-inc/villeco"]);
  });

  it("accepts owner/name and nothing that could pass for an option or a path", () => {
    expect(isRepoName("Villeco-inc/linea-web")).toBe(true);
    expect(isRepoName("villeco/pr_review.desk")).toBe(true);
    for (const bad of ["", "villeco", "--help", "-x/y", "--help/x", "x/", "/y", "a/b/c", "a b/c", "a/b c", "all", "a/..", "a/."]) {
      expect(isRepoName(bad)).toBe(false);
    }
  });

  it("refuses what is not even a string, such as a list a request body could carry", () => {
    expect(isRepoName(["Villeco-inc/linea-web"])).toBe(false);
    expect(isRepoName(undefined)).toBe(false);
    expect(isRepoName(42)).toBe(false);
  });

  it("serves only valid, distinct repositories from a selection saved under an older rule", () => {
    const db = openDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('selected_repos', ?)").run(
      JSON.stringify(["-x/y", "Villeco-inc/Linea-Web", "villeco-inc/linea-web", "Villeco-inc/villeco"])
    );
    expect(selectedRepos(db, undefined)).toEqual(["Villeco-inc/Linea-Web", "Villeco-inc/villeco"]);
  });

  it("reads a repository whatever its case and answers with the selected spelling", () => {
    expect(scopeOf("villeco-inc/linea-web", ["Villeco-inc/Linea-Web"])).toEqual(["Villeco-inc/Linea-Web"]);
  });

  it("saves a repository once whatever the case it is spelled in", () => {
    const db = openDb();
    expect(saveSelectedRepos(db, ["Villeco-inc/linea-web", "villeco-inc/Linea-Web"])).toEqual(["Villeco-inc/linea-web"]);
    expect(selectedRepos(db, undefined)).toEqual(["Villeco-inc/linea-web"]);
    expect(saveSelectedRepos(db, ["VILLECO-INC/LINEA-WEB", "Villeco-inc/linea-mobile"])).toEqual(["Villeco-inc/linea-mobile"]);
  });

  it("reads 'all' as nothing when nothing is selected", () => {
    expect(scopeOf("all", [])).toEqual([]);
  });

  it("refuses an empty pick and keeps the previous one", () => {
    const db = openDb();
    saveSelectedRepos(db, ["Villeco-inc/villeco"]);
    expect(() => saveSelectedRepos(db, [])).toThrow("Pick at least one repository");
    expect(selectedRepos(db, undefined)).toEqual(["Villeco-inc/villeco"]);
  });

  it("refuses a name that is not owner/name", () => {
    const db = openDb();
    expect(() => saveSelectedRepos(db, ["villeco"])).toThrow("Not a repository: villeco");
    expect(selectedRepos(db, "Villeco-inc/villeco")).toEqual(["Villeco-inc/villeco"]);
  });

  it("survives the database being reopened, as when the container is recreated", () => {
    const file = tempDbFile();
    const first = openDb(file);
    saveSelectedRepos(first, ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
    first.close();
    expect(selectedRepos(openDb(file), undefined)).toEqual(["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
  });
});

describe("schema upgrade", () => {
  it("keeps existing reviews when the new version migrates the database", () => {
    const file = tempDbFile();
    const before = openDb(file);
    before
      .prepare("INSERT INTO reviews (id, repo, number, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("Villeco-inc/villeco#42", "Villeco-inc/villeco", 42, "Corriger les levées", "reported", "2026-10-01T12:00:00Z", "2026-10-01T12:00:00Z");
    before.close();
    const after = openDb(file);
    expect(after.prepare("SELECT repo, number, title, status FROM reviews").all()).toEqual([
      { repo: "Villeco-inc/villeco", number: 42, title: "Corriger les levées", status: "reported" },
    ]);
  });
});
