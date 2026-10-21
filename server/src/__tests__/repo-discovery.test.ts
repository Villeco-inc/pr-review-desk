import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { githubRepoFromRemote, originFromGitConfig, scanRepos } from "../services/repo-discovery";

describe("githubRepoFromRemote", () => {
  it("reads every GitHub remote form", () => {
    expect(githubRepoFromRemote("git@github.com:acme/api.git")).toBe("acme/api");
    expect(githubRepoFromRemote("https://github.com/acme/api")).toBe("acme/api");
    expect(githubRepoFromRemote("https://github.com/acme/api.git")).toBe("acme/api");
    expect(githubRepoFromRemote("ssh://git@github.com/acme/Synkro_Acquisition.git")).toBe("acme/Synkro_Acquisition");
  });

  it("ignores remotes that are not on GitHub", () => {
    expect(githubRepoFromRemote("git@gitlab.com:acme/api.git")).toBeNull();
  });
});

describe("originFromGitConfig", () => {
  it("takes the url of origin, not of another remote", () => {
    const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/api.git\n[remote "origin"]\n\turl = git@github.com:acme/api.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
    expect(originFromGitConfig(config)).toBe("git@github.com:acme/api.git");
  });
});

describe("scanRepos", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scan-")));
  const repo = (name: string, config: string | null) => {
    fs.mkdirSync(path.join(root, name, ".git"), { recursive: true });
    if (config !== null) fs.writeFileSync(path.join(root, name, ".git", "config"), config);
  };
  repo("api", '[remote "origin"]\n\turl = git@github.com:acme/api.git\n');
  repo("scratch", "[core]\n\tbare = false\n");
  repo(".hidden", '[remote "origin"]\n\turl = git@github.com:acme/hidden.git\n');
  fs.mkdirSync(path.join(root, "worktree"));
  fs.writeFileSync(path.join(root, "worktree", ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
  fs.mkdirSync(path.join(root, "notes"));

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("keeps checkouts, names their GitHub repo, and skips worktrees, hidden and plain folders", () => {
    expect(scanRepos(root)).toEqual([
      { label: "api", path: path.join(root, "api"), ghRepo: "acme/api" },
      { label: "scratch", path: path.join(root, "scratch"), ghRepo: null },
    ]);
  });

  it("returns nothing for a folder that does not exist", () => {
    expect(scanRepos(path.join(root, "missing"))).toEqual([]);
  });
});
