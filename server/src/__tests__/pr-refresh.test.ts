import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../db/schema";
import { createPrRefresher } from "../services/pr-refresh";
import type { PullRequest } from "../../../shared/types";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

function pr(repo: string, title: string): PullRequest {
  return {
    repo,
    number: 1,
    title,
    author: "dann",
    url: `https://github.com/${repo}/pull/1`,
    updatedAt: "2026-10-15T12:00:00Z",
    isDraft: false,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    headRefOid: "abc",
    baseRefName: "main",
    headRefName: "feat/x",
    labels: [],
    reviewDecision: null,
  };
}

// GitHub, the only boundary: every fetch answers with the next version, so a title says which fetch it came from.
function fakeGithub(failing: string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    fetchPrs: async (repo: string) => {
      calls.push(repo);
      if (failing.includes(repo)) throw new Error("gh: not found");
      return [pr(repo, `v${calls.length}`)];
    },
  };
}

const titles = (prs: PullRequest[]) => prs.map((p) => p.title);

describe("pull request cache", () => {
  it("fetches a repository once and serves the cache afterwards", async () => {
    const gh = fakeGithub();
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });

    expect(titles(await refresher.list(["Villeco-inc/linea-web"]))).toEqual(["v1"]);
    expect(titles(await refresher.list(["Villeco-inc/linea-web"]))).toEqual(["v1"]);
  });

  it("serves the repositories that have data when another never had any", async () => {
    const gh = fakeGithub(["Villeco-inc/linea-mobile"]);
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });
    const both = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];

    expect(titles(await refresher.list(both))).toEqual(["v1"]);
    expect(refresher.freshness(both)).toMatchObject({ fetchedAt: null, error: "gh: not found" });
  });

  it("does not ask GitHub again on a read for a repository that just failed", async () => {
    const gh = fakeGithub(["Villeco-inc/linea-mobile"]);
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });
    const both = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];

    await refresher.list(both);
    await refresher.list(both);

    expect(gh.calls).toEqual(["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);
  });

  it("reports the error on every read when nothing can be shown, asking GitHub once", async () => {
    const gh = fakeGithub(["Villeco-inc/linea-mobile"]);
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });

    await expect(refresher.list(["Villeco-inc/linea-mobile"])).rejects.toThrow("gh: not found");
    await expect(refresher.list(["Villeco-inc/linea-mobile"])).rejects.toThrow("gh: not found");

    expect(gh.calls).toEqual(["Villeco-inc/linea-mobile"]);
  });

  it("fetches again when a refresh is forced", async () => {
    const gh = fakeGithub();
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });

    await refresher.list(["Villeco-inc/linea-web"]);

    expect(titles(await refresher.list(["Villeco-inc/linea-web"], true))).toEqual(["v2"]);
  });

  it("joins several repositories in the order asked", async () => {
    const gh = fakeGithub();
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });

    const prs = await refresher.list(["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"]);

    expect(prs.map((p) => `${p.repo} ${p.title}`)).toEqual(["Villeco-inc/linea-web v1", "Villeco-inc/linea-mobile v2"]);
  });

  it("warms every selected repository, reading the selection again each time", async () => {
    const gh = fakeGithub();
    let selection = ["Villeco-inc/linea-web"];
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => selection });

    await refresher.warm();
    selection = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];
    await refresher.warm();

    expect(titles(await refresher.list(selection))).toEqual(["v2", "v3"]);
  });

  it("shares one fetch between simultaneous requests for the same repository", async () => {
    const gh = fakeGithub();
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [] });

    const [first, second] = await Promise.all([refresher.list(["Villeco-inc/linea-web"]), refresher.list(["Villeco-inc/linea-web"])]);

    expect(titles(first)).toEqual(["v1"]);
    expect(titles(second)).toEqual(["v1"]);
  });

  it("warms only the repositories it is given", async () => {
    const gh = fakeGithub();
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => ["Villeco-inc/linea-web", "Villeco-inc/villeco"] });

    await refresher.warm(["Villeco-inc/linea-mobile"]);

    expect(gh.calls).toEqual(["Villeco-inc/linea-mobile"]);
  });

  it("refreshes at startup, then after each delay it is given, rereading the delay every cycle", async () => {
    vi.useFakeTimers();
    try {
      const repo = "Villeco-inc/linea-web";
      const gh = fakeGithub();
      const delays = [1000, 5000];
      let asked = 0;
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => [repo],
        refreshEveryMs: () => delays[Math.min(asked++, delays.length - 1)],
      });

      refresher.touch();
      const stop = refresher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(gh.calls).toEqual([repo]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(gh.calls).toEqual([repo, repo]);

      await vi.advanceTimersByTimeAsync(4000);
      expect(gh.calls).toEqual([repo, repo]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(gh.calls).toEqual([repo, repo, repo]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps its schedule when reading the selection fails once", async () => {
    vi.useFakeTimers();
    try {
      const repo = "Villeco-inc/linea-web";
      const gh = fakeGithub();
      let reads = 0;
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => {
          reads += 1;
          if (reads === 2) throw new Error("db locked");
          return [repo];
        },
        refreshEveryMs: () => 1000,
      });

      refresher.touch();
      const stop = refresher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(gh.calls).toEqual([repo]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(gh.calls).toEqual([repo]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(gh.calls).toEqual([repo, repo]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to ninety seconds when the delay it is given cannot be used", async () => {
    vi.useFakeTimers();
    try {
      const repo = "Villeco-inc/linea-web";
      const gh = fakeGithub();
      const settings = [
        () => {
          throw new Error("bad setting");
        },
        () => 0,
      ];
      let asked = 0;
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => [repo],
        refreshEveryMs: () => settings[Math.min(asked++, settings.length - 1)](),
      });

      refresher.touch();
      const stop = refresher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(gh.calls).toEqual([repo]);

      await vi.advanceTimersByTimeAsync(89_999);
      expect(gh.calls).toEqual([repo]);
      await vi.advanceTimersByTimeAsync(1);
      expect(gh.calls).toEqual([repo, repo]);

      await vi.advanceTimersByTimeAsync(89_999);
      expect(gh.calls).toEqual([repo, repo]);
      await vi.advanceTimersByTimeAsync(1);
      expect(gh.calls).toEqual([repo, repo, repo]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ticks only while a client was seen in the last ten minutes", async () => {
    const repo = "Villeco-inc/linea-web";
    const gh = fakeGithub();
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [repo], now: () => clock });

    await refresher.tick();
    expect(gh.calls).toEqual([]);

    refresher.touch();
    clock += 9 * 60_000;
    await refresher.tick();
    expect(gh.calls).toEqual([repo]);

    clock += 2 * 60_000;
    await refresher.tick();
    expect(gh.calls).toEqual([repo]);
  });

  it("dates a group of repositories by the oldest fetch, and by nothing while one was never fetched", async () => {
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: fakeGithub().fetchPrs, selected: () => [], now: () => clock });
    const web = "Villeco-inc/linea-web";
    const mobile = "Villeco-inc/linea-mobile";

    await refresher.list([web]);
    expect(refresher.freshness([web, mobile]).fetchedAt).toBeNull();

    clock += 90_000;
    await refresher.list([mobile]);
    expect(refresher.freshness([web, mobile]).fetchedAt).toBe("2026-10-15T12:00:00.000Z");
    expect(refresher.freshness([mobile]).fetchedAt).toBe("2026-10-15T12:01:30.000Z");
  });

  it("changes its version whenever any repository is fetched again, even when the oldest fetch does not move", async () => {
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: fakeGithub().fetchPrs, selected: () => [], now: () => clock });
    const both = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];

    await refresher.list(both);
    const before = refresher.freshness(both);
    clock += 90_000;
    await refresher.warm(["Villeco-inc/linea-mobile"]);
    const after = refresher.freshness(both);

    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(after.version).not.toBe(before.version);
    expect(refresher.freshness(both).version).toBe(after.version);
  });

  it("refreshes at once when a client comes back after the quiet period, not on the first visit", async () => {
    const repo = "Villeco-inc/linea-web";
    const gh = fakeGithub();
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [repo], now: () => clock });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    refresher.touch();
    await settle();
    expect(gh.calls).toEqual([]);

    clock += 5 * 60_000;
    refresher.touch();
    await settle();
    expect(gh.calls).toEqual([]);

    clock += 11 * 60_000;
    refresher.touch();
    await vi.waitFor(() => expect(gh.calls).toEqual([repo]));
  });

  it("stops ticking after the quiet period it is given", async () => {
    const repo = "Villeco-inc/linea-web";
    const gh = fakeGithub();
    let clock = Date.parse("2026-10-15T12:00:00Z");
    const refresher = createPrRefresher({
      db: openDb(),
      fetchPrs: gh.fetchPrs,
      selected: () => [repo],
      now: () => clock,
      activeWindowMs: () => 30_000,
    });

    refresher.touch();
    clock += 29_000;
    await refresher.tick();
    expect(gh.calls).toEqual([repo]);

    clock += 2_000;
    await refresher.tick();
    expect(gh.calls).toEqual([repo]);
  });

  it("changes its version when a review of the repository changes status or gets findings handled, and only then", async () => {
    const repo = "Villeco-inc/linea-web";
    const db = openDb();
    const refresher = createPrRefresher({
      db,
      fetchPrs: fakeGithub().fetchPrs,
      selected: () => [],
      now: () => Date.parse("2026-10-15T12:00:00Z"),
    });
    const version = () => refresher.freshness([repo]).version;
    const addReview = (id: string, forRepo: string) =>
      db.prepare("INSERT INTO reviews (id, repo, number, status, created_at, updated_at) VALUES (?, ?, 1, 'running', 't', 't')").run(id, forRepo);

    await refresher.list([repo]);
    const none = version();
    expect(version()).toBe(none);

    addReview("other", "Villeco-inc/linea-mobile");
    expect(version()).toBe(none);

    addReview("r1", repo);
    const started = version();
    expect(started).not.toBe(none);

    db.prepare("UPDATE reviews SET status = 'failed' WHERE id = 'r1'").run();
    const failed = version();
    expect(failed).not.toBe(started);

    db.prepare("INSERT INTO findings (id, review_id, state) VALUES ('f1', 'r1', 'open')").run();
    const found = version();
    expect(found).not.toBe(failed);

    db.prepare("UPDATE findings SET state = 'posted' WHERE id = 'f1'").run();
    const posted = version();
    expect(posted).not.toBe(found);
    expect(version()).toBe(posted);

    db.prepare("INSERT INTO findings (id, review_id, state) VALUES ('f2', 'r1', 'dismissed')").run();
    expect(version()).toBe(posted);
    db.prepare("UPDATE findings SET state = 'posted' WHERE id = 'f2'").run();
    expect(version()).not.toBe(posted);
  });

  it("keeps the recorded error when the fetched list cannot be stored", async () => {
    const repo = "Villeco-inc/linea-web";
    let attempt = 0;
    const refresher = createPrRefresher({
      db: openDb(),
      fetchPrs: async (r) => {
        attempt += 1;
        if (attempt === 1) throw new Error("gh: HTTP 401");
        return [{ ...pr(r, "v2"), additions: BigInt(10) as unknown as number }];
      },
      selected: () => [],
    });

    await refresher.warm([repo]);
    await refresher.warm([repo]);

    expect(refresher.freshness([repo])).toMatchObject({ fetchedAt: null, error: "gh: HTTP 401" });
  });

  it("waits for every repository on a forced refresh before reporting a failure", async () => {
    const web = "Villeco-inc/linea-web";
    const mobile = "Villeco-inc/linea-mobile";
    const refresher = createPrRefresher({
      db: openDb(),
      fetchPrs: async (repo) => {
        if (repo === mobile) throw new Error("gh: not found");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [pr(repo, "slow")];
      },
      selected: () => [],
      now: () => Date.parse("2026-10-15T12:00:00Z"),
    });

    await expect(refresher.list([mobile, web], true)).rejects.toThrow("gh: not found");

    expect(refresher.freshness([web]).fetchedAt).toBe("2026-10-15T12:00:00.000Z");
  });

  describe("when nobody is looking", () => {
    const repo = "Villeco-inc/linea-web";
    const minutes = (n: number) => n * 60_000;

    it("still refreshes, but only every thirty minutes by default", async () => {
      const gh = fakeGithub();
      let clock = Date.parse("2026-10-15T12:00:00Z");
      const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [repo], now: () => clock });

      await refresher.warm();
      clock += minutes(29);
      await refresher.tick();
      expect(gh.calls).toEqual([repo]);

      clock += minutes(2);
      await refresher.tick();
      expect(gh.calls).toEqual([repo, repo]);
    });

    it("waits as long as the delay it is given, read again at every tick", async () => {
      const gh = fakeGithub();
      let clock = Date.parse("2026-10-15T12:00:00Z");
      let delay = minutes(2);
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => [repo],
        now: () => clock,
        idleRefreshEveryMs: () => delay,
      });

      await refresher.warm();
      clock += minutes(2) - 1;
      await refresher.tick();
      expect(gh.calls).toEqual([repo]);

      clock += 1;
      await refresher.tick();
      expect(gh.calls).toEqual([repo, repo]);

      delay = minutes(5);
      clock += minutes(4);
      await refresher.tick();
      expect(gh.calls).toEqual([repo, repo]);
    });

    it("never goes below what GitHub's rate limit allows for the number of repositories selected", async () => {
      const repos = Array.from({ length: 10 }, (_, i) => `Villeco-inc/repo-${i}`);
      const gh = fakeGithub();
      let clock = Date.parse("2026-10-15T12:00:00Z");
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => repos,
        now: () => clock,
        idleRefreshEveryMs: () => 1000,
      });

      await refresher.warm();
      clock += 57_000;
      await refresher.tick();
      expect(gh.calls).toHaveLength(10);

      clock += 1_000;
      await refresher.tick();
      expect(gh.calls).toHaveLength(20);
    });

    it("does not count the refresh of one repository as a refresh of all of them", async () => {
      const gh = fakeGithub();
      let clock = Date.parse("2026-10-15T12:00:00Z");
      const refresher = createPrRefresher({ db: openDb(), fetchPrs: gh.fetchPrs, selected: () => [repo], now: () => clock });

      await refresher.warm();
      clock += minutes(29);
      await refresher.warm(["Villeco-inc/linea-mobile"]);
      clock += minutes(2);
      await refresher.tick();

      expect(gh.calls).toEqual([repo, "Villeco-inc/linea-mobile", repo]);
    });

    it("falls back to thirty minutes when the delay it is given cannot be used", async () => {
      const gh = fakeGithub();
      let clock = Date.parse("2026-10-15T12:00:00Z");
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: gh.fetchPrs,
        selected: () => [repo],
        now: () => clock,
        idleRefreshEveryMs: () => {
          throw new Error("bad setting");
        },
      });

      await refresher.warm();
      clock += minutes(29);
      await refresher.tick();
      expect(gh.calls).toEqual([repo]);

      clock += minutes(2);
      await refresher.tick();
      expect(gh.calls).toEqual([repo, repo]);
    });
  });

  describe("what freshness tells about a refresh under way", () => {
    const repo = "Villeco-inc/linea-web";

    it("says a repository is being refreshed while GitHub is being asked, and not before or after", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: async (r) => {
          await gate;
          return [pr(r, "v1")];
        },
        selected: () => [],
      });

      expect(refresher.freshness([repo]).refreshing).toBe(false);
      const warming = refresher.warm([repo]);
      expect(refresher.freshness([repo]).refreshing).toBe(true);
      expect(refresher.freshness(["Villeco-inc/linea-mobile"]).refreshing).toBe(false);

      release();
      await warming;
      expect(refresher.freshness([repo]).refreshing).toBe(false);
    });

    it("does not change the version of the data when a refresh starts", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refresher = createPrRefresher({
        db: openDb(),
        fetchPrs: async (r) => {
          await gate;
          return [pr(r, "v1")];
        },
        selected: () => [],
      });

      const before = refresher.freshness([repo]).version;
      const warming = refresher.warm([repo]);
      expect(refresher.freshness([repo]).version).toBe(before);
      release();
      await warming;
    });

    it("gives the delay between refreshes while a client is looking, so a page can tell how old is too old", () => {
      const defaults = createPrRefresher({ db: openDb(), fetchPrs: fakeGithub().fetchPrs, selected: () => [] });
      expect(defaults.freshness([repo]).activeEveryMs).toBe(90_000);

      const set = createPrRefresher({ db: openDb(), fetchPrs: fakeGithub().fetchPrs, selected: () => [], refreshEveryMs: () => 45_000 });
      expect(set.freshness([repo]).activeEveryMs).toBe(45_000);

      const broken = createPrRefresher({
        db: openDb(),
        fetchPrs: fakeGithub().fetchPrs,
        selected: () => [],
        refreshEveryMs: () => {
          throw new Error("bad setting");
        },
      });
      expect(broken.freshness([repo]).activeEveryMs).toBe(90_000);
    });
  });

  it("keeps the cached list when a refresh fails and reports the error", async () => {
    const repo = "Villeco-inc/linea-web";
    let clock = Date.parse("2026-10-15T12:00:00Z");
    let failing = false;
    const refresher = createPrRefresher({
      db: openDb(),
      fetchPrs: async (r) => {
        if (failing) throw new Error("gh: HTTP 401");
        return [pr(r, "v1")];
      },
      selected: () => [repo],
      now: () => clock,
    });

    await refresher.warm();
    clock += 90_000;
    failing = true;
    await refresher.warm();

    expect(titles(await refresher.list([repo]))).toEqual(["v1"]);
    expect(refresher.freshness([repo])).toMatchObject({ fetchedAt: "2026-10-15T12:00:00.000Z", error: "gh: HTTP 401" });
  });
});
