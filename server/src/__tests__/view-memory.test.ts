import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema";
import { forgetLocalSelection, readViewMemory, rememberLocalSelection, rememberPrView } from "../services/view-memory";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

const SELECTION = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];

describe("view memory, pull request list", () => {
  it("is empty until something is remembered", () => {
    expect(readViewMemory(openDb(), SELECTION)).toEqual({
      prs: { repo: null, filters: {} },
      local: { label: null, selection: {} },
    });
  });

  it("remembers the last repository, and keeps each repository's own filters", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "Villeco-inc/linea-web", { author: ["bob"], sort: "updated" });
    rememberPrView(db, SELECTION, "Villeco-inc/linea-mobile", { label: ["bug"] });

    expect(readViewMemory(db, SELECTION).prs).toEqual({
      repo: "Villeco-inc/linea-mobile",
      filters: {
        "Villeco-inc/linea-web": { author: ["bob"], sort: "updated" },
        "Villeco-inc/linea-mobile": { label: ["bug"] },
      },
    });
  });

  it("stores a repository under the spelling of the selection", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "villeco-inc/LINEA-WEB", {});
    expect(readViewMemory(db, SELECTION).prs.repo).toBe("Villeco-inc/linea-web");
  });

  it("remembers the view of all the selected repositories", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "all", { status: ["draft"] });
    expect(readViewMemory(db, SELECTION).prs).toEqual({ repo: "all", filters: { all: { status: ["draft"] } } });
  });

  it("stops serving a repository that left the selection, with its filters, but keeps the view of all", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "Villeco-inc/linea-web", { author: ["bob"] });
    rememberPrView(db, SELECTION, "Villeco-inc/linea-mobile", { label: ["bug"] });

    expect(readViewMemory(db, ["Villeco-inc/linea-web"]).prs).toEqual({
      repo: null,
      filters: { "Villeco-inc/linea-web": { author: ["bob"] } },
    });

    rememberPrView(db, SELECTION, "all", { status: ["draft"] });
    expect(readViewMemory(db, []).prs).toEqual({ repo: "all", filters: { all: { status: ["draft"] } } });
  });

  it("keeps only what a filter can hold", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "Villeco-inc/linea-web", {
      author: ["alice", 5, "x".repeat(300)],
      status: "draft",
      evil: { deep: true },
      sort: "updated",
      dir: 7,
    });
    expect(readViewMemory(db, SELECTION).prs.filters["Villeco-inc/linea-web"]).toEqual({ author: ["alice"], sort: "updated" });
  });

  it("reads a damaged row as empty, and the next remembered view repairs it", () => {
    const db = openDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('view_memory', 'not json')").run();
    expect(readViewMemory(db, SELECTION).prs).toEqual({ repo: null, filters: {} });

    rememberPrView(db, SELECTION, "Villeco-inc/linea-web", { author: ["bob"] });
    expect(readViewMemory(db, SELECTION).prs.repo).toBe("Villeco-inc/linea-web");
  });

  it("refuses a repository that is not selected and keeps what it had", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, "Villeco-inc/linea-web", { author: ["bob"] });
    expect(() => rememberPrView(db, SELECTION, "Villeco-inc/other", { author: ["eve"] })).toThrow("not a selected repository");
    expect(readViewMemory(db, SELECTION).prs).toEqual({
      repo: "Villeco-inc/linea-web",
      filters: { "Villeco-inc/linea-web": { author: ["bob"] } },
    });
  });
});

describe("view memory, writes", () => {
  const web = "Villeco-inc/linea-web";
  const writes = (db: Database.Database) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

  it("does not write again what it already holds, and writes what differs", () => {
    const db = openDb();
    rememberPrView(db, SELECTION, web, { author: ["bob"] });
    const before = writes(db);

    rememberPrView(db, SELECTION, web, { author: ["bob"] });
    expect(writes(db)).toBe(before);

    rememberPrView(db, SELECTION, web, { author: ["bob", "eve"] });
    expect(writes(db)).toBe(before + 1);
  });

  it("does not write again a local selection it already holds, nor the forgetting of one it never had", () => {
    const db = openDb();
    rememberLocalSelection(db, "api", { branch: "feat/x", base: "main" });
    const before = writes(db);

    rememberLocalSelection(db, "api", { branch: "feat/x", base: "main" });
    forgetLocalSelection(db, "unknown");
    expect(writes(db)).toBe(before);

    forgetLocalSelection(db, "api");
    expect(writes(db)).toBe(before + 1);
  });
});

describe("view memory, local branches", () => {
  it("remembers the last local repository, and each one's own branch pair", () => {
    const db = openDb();
    rememberLocalSelection(db, "api", { branch: "feat/x", base: "main" });
    rememberLocalSelection(db, "web", { branch: "fix/y" });
    expect(readViewMemory(db, SELECTION).local).toEqual({
      label: "web",
      selection: { api: { branch: "feat/x", base: "main" }, web: { branch: "fix/y" } },
    });
  });

  it("forgets a local repository, and stops pointing at it only when it was the last one", () => {
    const db = openDb();
    rememberLocalSelection(db, "api", { branch: "feat/x" });
    rememberLocalSelection(db, "web", { branch: "fix/y" });

    forgetLocalSelection(db, "api");
    expect(readViewMemory(db, SELECTION).local).toEqual({ label: "web", selection: { web: { branch: "fix/y" } } });

    forgetLocalSelection(db, "web");
    expect(readViewMemory(db, SELECTION).local).toEqual({ label: null, selection: {} });
  });

  it("keeps only a branch and a base, and refuses a label that cannot be one", () => {
    const db = openDb();
    rememberLocalSelection(db, "api", { branch: "feat/x", base: 5, evil: true });
    expect(readViewMemory(db, SELECTION).local.selection.api).toEqual({ branch: "feat/x" });

    for (const bad of ["", "x".repeat(81), "__proto__", "a\u0000b"]) {
      expect(() => rememberLocalSelection(db, bad, {})).toThrow("not a local repository label");
    }
  });

  it("remembers a local repository whatever it is called in the configuration, accents and spaces included", () => {
    const db = openDb();
    rememberLocalSelection(db, "dépôt-api", { branch: "feat/x" });
    rememberLocalSelection(db, "dépôt web", { branch: "fix/y" });
    expect(readViewMemory(db, SELECTION).local).toEqual({
      label: "dépôt web",
      selection: { "dépôt-api": { branch: "feat/x" }, "dépôt web": { branch: "fix/y" } },
    });
  });

  it("stops remembering new local repositories after a hundred", () => {
    const db = openDb();
    for (let i = 0; i < 100; i++) rememberLocalSelection(db, `repo-${i}`, { branch: "b" });
    expect(() => rememberLocalSelection(db, "one-more", {})).toThrow("too many local repositories");
    rememberLocalSelection(db, "repo-3", { branch: "c" });
    expect(readViewMemory(db, SELECTION).local.selection["repo-3"]).toEqual({ branch: "c" });
  });
});
