import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { saveSelectedRepos, selectedRepos } from "../services/repo-selection";

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
