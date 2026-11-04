import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { findReview } from "../services/review-lookup";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

const addReview = (db: Database.Database, repo: string, number: number, updatedAt: string) =>
  db.prepare("INSERT INTO reviews (id, repo, number, status, created_at, updated_at) VALUES (?, ?, ?, 'reported', 't', ?)").run(`${repo}#${number}`, repo, number, updatedAt);

describe("finding the review of a pull request", () => {
  it("finds it whatever the case its repository was written in when the review was made", () => {
    const db = openDb();
    addReview(db, "villeco-inc/linea-web", 7, "2026-10-15T12:00:00Z");

    expect(findReview(db, "Villeco-inc/linea-web", 7)?.id).toBe("villeco-inc/linea-web#7");
  });

  it("finds nothing for another pull request or another repository", () => {
    const db = openDb();
    addReview(db, "Villeco-inc/linea-web", 7, "2026-10-15T12:00:00Z");

    expect(findReview(db, "Villeco-inc/linea-web", 8)).toBeUndefined();
    expect(findReview(db, "Villeco-inc/linea-mobile", 7)).toBeUndefined();
  });

  it("takes the most recent review when the repository was written in two cases", () => {
    const db = openDb();
    addReview(db, "Villeco-inc/linea-web", 7, "2026-10-15T12:00:00Z");
    addReview(db, "villeco-inc/linea-web", 7, "2026-10-16T12:00:00Z");

    expect(findReview(db, "Villeco-inc/linea-web", 7)?.id).toBe("villeco-inc/linea-web#7");
  });
});
