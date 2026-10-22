import type Database from "better-sqlite3";
import type { ReviewRow } from "../../../shared/types";

/** The review of a pull request, whatever the case its repository was written in when the review was made. */
export function findReview(db: Database.Database, repo: string, number: number): ReviewRow | undefined {
  return db.prepare("SELECT * FROM reviews WHERE lower(repo) = lower(?) AND number = ? ORDER BY updated_at DESC LIMIT 1").get(repo, number) as ReviewRow | undefined;
}
