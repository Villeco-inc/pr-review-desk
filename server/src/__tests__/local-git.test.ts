import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLocalDiff } from "../services/local-git";

// A real repo shaped like the one that produced a review of other tickets' work:
// origin/staging moved on, local staging did not, and the branch's work sits uncommitted
// in a worktree.
let root = "";
let repo = "";
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

beforeAll(() => {
  // realpath: on macOS the temp dir is a symlink, and git reports the resolved path.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-git-")));
  const remote = path.join(root, "remote.git");
  repo = path.join(root, "repo");
  sh(root, "init", "-q", "--bare", "-b", "staging", remote);
  sh(root, "clone", "-q", remote, repo);
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  write(repo, "app.rb", "one\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
  sh(repo, "push", "-q", "origin", "HEAD:staging");

  // Someone else's ticket lands on origin/staging; local staging stays behind.
  const other = path.join(root, "other");
  sh(root, "clone", "-q", remote, other);
  sh(other, "config", "user.email", "t@t");
  sh(other, "config", "user.name", "t");
  write(other, "billing.rb", "other ticket\n");
  sh(other, "add", "-A");
  sh(other, "commit", "-q", "-m", "fix(OTHER-1): someone else's work");
  sh(other, "push", "-q", "origin", "HEAD:staging");
  sh(repo, "fetch", "-q", "origin");

  // Branch cut from the up-to-date origin/staging, work left uncommitted in a worktree.
  sh(repo, "branch", "feat/idle", "origin/staging");
  sh(repo, "branch", "feat/wip", "origin/staging");
  sh(repo, "worktree", "add", "-q", path.join(repo, ".worktrees", "wip"), "feat/wip");
  const wt = path.join(repo, ".worktrees", "wip");
  write(wt, "app.rb", "one\ntwo\n");
  write(wt, "lib/new_lookup.rb", "new\nfile\n");

  // And one branch with a real commit of its own, not checked out anywhere.
  sh(repo, "branch", "feat/done", "origin/staging");
  sh(repo, "worktree", "add", "-q", path.join(root, "tmp-done"), "feat/done");
  write(path.join(root, "tmp-done"), "done.rb", "done\n");
  sh(path.join(root, "tmp-done"), "add", "-A");
  sh(path.join(root, "tmp-done"), "commit", "-q", "-m", "feat: done");
  sh(repo, "worktree", "remove", path.join(root, "tmp-done"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("getLocalDiff", () => {
  it("compares with origin/<base>, so a stale local base does not pull in other tickets", async () => {
    const r = await getLocalDiff(repo, "feat/idle", "staging");
    expect(r.baseRef).toBe("origin/staging");
    expect(r.ownCommits).toBe(0);
    expect(r.diff).toBe("");
    expect(r.diff).not.toContain("billing.rb");
  });

  it("includes uncommitted edits and new files from the branch's worktree", async () => {
    const r = await getLocalDiff(repo, "feat/wip", "staging");
    expect(r.worktree).toBe(path.join(repo, ".worktrees", "wip"));
    expect(r.ownCommits).toBe(0);
    expect(r.uncommittedFiles).toBe(2);
    expect(r.files.map((f) => f.path).sort()).toEqual(["app.rb", "lib/new_lookup.rb"]);
    expect(r.files.find((f) => f.path === "lib/new_lookup.rb")?.additions).toBe(2);
    expect(r.diff).toContain("+two");
    expect(r.diff).toContain("+++ b/lib/new_lookup.rb");
    expect(r.diff).not.toContain("billing.rb");
  });

  it("reads a branch's own commits when it is not checked out anywhere", async () => {
    const r = await getLocalDiff(repo, "feat/done", "staging");
    expect(r.worktree).toBeNull();
    expect(r.ownCommits).toBe(1);
    expect(r.files.map((f) => f.path)).toEqual(["done.rb"]);
  });
});
