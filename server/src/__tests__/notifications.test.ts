import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { insertNotification, listNotifications, markAllRead, outcomeNotification, unreadCount, watchEventNotification } from "../services/notifications";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("notification history", () => {
  it("counts unread notifications until the list is opened", () => {
    const db = openDb();
    insertNotification(db, outcomeNotification({ reviewId: "a/b#1", status: "reported", title: "a/b#1 — One", findings: 3, target: { kind: "pr", repo: "a/b", number: 1 } }));
    insertNotification(db, outcomeNotification({ reviewId: "a/b#2", status: "failed", title: "a/b#2 — Two", error: "boom", target: null }));
    expect(unreadCount(db)).toBe(2);

    expect(markAllRead(db)).toBe(2);
    expect(unreadCount(db)).toBe(0);
    expect(listNotifications(db).every((n) => n.readAt !== null)).toBe(true);
  });

  it("lists newest first, with the review's target and the same tag as before", () => {
    const db = openDb();
    insertNotification(db, outcomeNotification({ reviewId: "a/b#1", status: "reported", title: "first", findings: 1, target: { kind: "pr", repo: "a/b", number: 1 } }));
    insertNotification(db, outcomeNotification({ reviewId: "a/b#2", status: "failed", title: "second", error: "boom", target: null }));
    const [latest, earlier] = listNotifications(db);
    expect(latest).toMatchObject({ kind: "review-failed", title: "second", body: "Review failed — boom", tag: "a/b#2:failed", target: null });
    expect(earlier).toMatchObject({ kind: "review-reported", body: "Review finished — 1 finding", tag: "a/b#1:reported", target: { kind: "pr", repo: "a/b", number: 1 } });
  });

  it("records a push or a reply once a day, a review request each time it comes", () => {
    const db = openDb();
    const push = watchEventNotification({ kind: "new-commits", repo: "a/b", number: 1, title: "One", url: "u", head: "bbbbbbbbb", reviewedHead: "a" });
    expect(insertNotification(db, push)).not.toBeNull();
    expect(insertNotification(db, push)).toBeNull();
    expect(insertNotification(db, push, new Date(Date.now() + 25 * 60 * 60_000))).not.toBeNull();

    const request = watchEventNotification({ kind: "review-requested", repo: "a/b", number: 1, title: "One", url: "u", author: "x" });
    expect(insertNotification(db, request)).not.toBeNull();
    expect(insertNotification(db, request)).not.toBeNull();
  });

  it("words GitHub events and opens their PR", () => {
    const reply = watchEventNotification({ kind: "comment-reply", repo: "a/b", number: 7, title: "Seven", url: "https://x#discussion_r9", author: "Cryptunas", body: "Done.\nSecond line", commentId: 9 });
    expect(reply).toMatchObject({ title: "a/b#7 — Seven", body: "Cryptunas replied: Done.", tag: "reply:9", url: "https://x#discussion_r9", target: { kind: "pr", repo: "a/b", number: 7 } });
  });
});
