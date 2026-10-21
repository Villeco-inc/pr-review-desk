// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadViewMemory, localMemory, prsMemory, resetViewMemory } from "./view-memory";

const ok = (data: unknown) => new Response(data === null ? null : JSON.stringify(data), { status: data === null ? 204 : 200 });

type Call = { url: string; method: string; body: unknown };

// The network is the only thing replaced: the real fetchJson runs against these answers.
function stubNetwork(answer: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      return answer(call);
    })
  );
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetViewMemory();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loading the memory", () => {
  it("serves what the server holds, synchronously once loaded", async () => {
    stubNetwork(() =>
      ok({
        prs: { repo: "Villeco-inc/linea-web", filters: { "Villeco-inc/linea-web": { author: ["bob"] } } },
        local: { label: "api", selection: { api: { branch: "feat/x", base: "main" } } },
      })
    );
    await loadViewMemory();

    expect(prsMemory.repo()).toBe("Villeco-inc/linea-web");
    expect(prsMemory.filters("Villeco-inc/linea-web")).toEqual({ author: ["bob"] });
    expect(prsMemory.filters("Villeco-inc/other")).toBeUndefined();
    expect(localMemory.label()).toBe("api");
    expect(localMemory.selection("api")).toEqual({ branch: "feat/x", base: "main" });
  });

  it("serves nothing when the server holds nothing", async () => {
    stubNetwork(() => ok({ prs: { repo: null, filters: {} }, local: { label: null, selection: {} } }));
    await loadViewMemory();
    expect(prsMemory.repo()).toBeUndefined();
    expect(localMemory.label()).toBeUndefined();
  });

  it("starts empty, without failing, when the server cannot be reached", async () => {
    stubNetwork(() => {
      throw new Error("connection refused");
    });
    await expect(loadViewMemory()).resolves.toBeUndefined();
    expect(prsMemory.repo()).toBeUndefined();
  });

  it("gives up on a server that does not answer, so the app still opens", async () => {
    stubNetwork(() => new Promise<Response>(() => {}));
    const loading = loadViewMemory(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(loading).resolves.toBeUndefined();
    expect(prsMemory.repo()).toBeUndefined();
  });
});

describe("remembering a pull request view", () => {
  const web = "Villeco-inc/linea-web";
  const mobile = "Villeco-inc/linea-mobile";
  const put = (repo: string, filters: unknown): Call => ({ url: "/api/view-memory/prs", method: "PUT", body: { repo, filters } });

  it("serves what was just remembered at once, and sends it once the changes stop", async () => {
    const calls = stubNetwork(() => ok(null));
    prsMemory.remember(web, { author: ["x"] });
    expect(prsMemory.repo()).toBe(web);
    expect(prsMemory.filters(web)).toEqual({ author: ["x"] });
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    prsMemory.remember(web, { author: ["x", "y"] });
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([put(web, { author: ["x", "y"] })]);
  });

  it("keeps the filters of a repository left within the wait, and sends the visits in order", async () => {
    const calls = stubNetwork(() => ok(null));
    prsMemory.remember(web, { author: ["a"] });
    prsMemory.remember(mobile, { label: ["b"] });
    prsMemory.remember(web, { author: ["a", "c"] });
    await vi.advanceTimersByTimeAsync(500);

    expect(calls).toEqual([put(mobile, { label: ["b"] }), put(web, { author: ["a", "c"] })]);
    expect(prsMemory.repo()).toBe(web);
  });

  it("sends what it already holds too, so the last tab to act wins over what another tab wrote since", async () => {
    stubNetwork(() => ok({ prs: { repo: web, filters: { [web]: { author: ["bob"], sort: "updated" } } }, local: { label: null, selection: {} } }));
    await loadViewMemory();
    const calls = stubNetwork(() => ok(null));

    prsMemory.remember(web, { sort: "updated", author: ["bob"] });
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([put(web, { sort: "updated", author: ["bob"] })]);
  });
});

describe("remembering a local selection", () => {
  const put = (label: string, selection: unknown): Call => ({ url: "/api/view-memory/local", method: "PUT", body: { label, selection } });

  it("serves it at once and sends it", async () => {
    const calls = stubNetwork(() => ok(null));
    localMemory.remember("api", { branch: "feat/x", base: "main" });
    expect(localMemory.label()).toBe("api");
    expect(localMemory.selection("api")).toEqual({ branch: "feat/x", base: "main" });

    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([put("api", { branch: "feat/x", base: "main" })]);
  });

  it("forgets a repository at once, and sends only the forgetting", async () => {
    const calls = stubNetwork(() => ok(null));
    localMemory.remember("api", { branch: "feat/x" });
    localMemory.forget("api");
    expect(localMemory.label()).toBeUndefined();
    expect(localMemory.selection("api")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([{ url: "/api/view-memory/local/api", method: "DELETE", body: undefined }]);
  });

  it("keeps pointing at the last repository when another one is forgotten", () => {
    stubNetwork(() => ok(null));
    localMemory.remember("api", { branch: "a" });
    localMemory.remember("web", { branch: "w" });
    localMemory.forget("api");
    expect(localMemory.label()).toBe("web");
    expect(localMemory.selection("web")).toEqual({ branch: "w" });
  });
});

describe("leaving and failing", () => {
  const web = "Villeco-inc/linea-web";

  it("sends what is waiting as the page goes away, without waiting for the delay", async () => {
    const calls = stubNetwork(() => ok(null));
    prsMemory.remember(web, { author: ["x"] });
    expect(calls).toEqual([]);

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ url: "/api/view-memory/prs", method: "PUT", body: { repo: web, filters: { author: ["x"] } } }]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it("sends every waiting change as the page goes away, not only the first", async () => {
    const mobile = "Villeco-inc/linea-mobile";
    const calls = stubNetwork(() => new Promise<Response>(() => {}));
    prsMemory.remember(web, { author: ["x"] });
    prsMemory.remember(mobile, { label: ["y"] });

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => (c.body as { repo: string }).repo)).toEqual([web, mobile]);
  });

  it("never lets a later batch overtake the one still being sent", async () => {
    const mobile = "Villeco-inc/linea-mobile";
    let release!: () => void;
    const gate = new Promise<Response>((resolve) => {
      release = () => resolve(ok(null));
    });
    let first = true;
    const calls = stubNetwork(() => {
      if (!first) return ok(null);
      first = false;
      return gate;
    });
    prsMemory.remember(web, { author: ["a"] });
    prsMemory.remember(mobile, { label: ["b"] });
    await vi.advanceTimersByTimeAsync(500);

    prsMemory.remember(web, { author: ["a", "c"] });
    await vi.advanceTimersByTimeAsync(500);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.map((c) => (c.body as { repo: string }).repo)).toEqual([web, mobile, web]);
    expect(calls[2].body).toEqual({ repo: web, filters: { author: ["a", "c"] } });
  });

  it("keeps serving what it remembered when a write fails, and does not fail", async () => {
    stubNetwork(() => {
      throw new Error("offline");
    });
    prsMemory.remember(web, { author: ["x"] });
    await vi.advanceTimersByTimeAsync(500);
    expect(prsMemory.repo()).toBe(web);
    expect(prsMemory.filters(web)).toEqual({ author: ["x"] });
  });
});
