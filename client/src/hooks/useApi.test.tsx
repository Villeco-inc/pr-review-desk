// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateCache, useQuery } from "./useApi";

// The network is the only thing replaced: the real fetchJson runs against these answers.
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const failure = (message: string) => new Response(JSON.stringify({ error: message }), { status: 500 });

type Route = () => Promise<Response> | Response;

function stubNetwork(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      calls.push(input);
      const route = routes[input];
      if (!route) throw new Error(`no answer stubbed for ${input}`);
      return route();
    })
  );
  return calls;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

// Lets the requests and state updates that are already due run to the end.
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  cleanup(); // no globals here, so nothing unmounts the hooks of a finished test by itself
  invalidateCache("/api/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useQuery", () => {
  it("reports a failed load, and a later successful poll clears it", async () => {
    const routes: Record<string, Route> = { "/api/a": () => failure("Internal Server Error") };
    stubNetwork(routes);
    const { result } = renderHook(() => useQuery<string[]>("/api/a", [], 0, 10_000));
    await flush();
    expect(result.current.error).toBe("Internal Server Error");
    expect(result.current.data).toBeNull();

    routes["/api/a"] = () => ok(["A"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.data).toEqual(["A"]);
    expect(result.current.error).toBeNull();
  });

  it("keeps what is on screen, and says nothing, when a quiet reload fails", async () => {
    const routes: Record<string, Route> = { "/api/a": () => ok(["A"]) };
    stubNetwork(routes);
    const { result } = renderHook(() => useQuery<string[]>("/api/a", [], 0, 10_000));
    await flush();
    expect(result.current.data).toEqual(["A"]);

    routes["/api/a"] = () => failure("Internal Server Error");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.data).toEqual(["A"]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("polls at the pace its last answer asks for, so a busy server is asked again sooner", async () => {
    const routes: Record<string, Route> = { "/api/busy": () => ok({ busy: true }) };
    const calls = stubNetwork(routes);
    const pace = (data: { busy: boolean } | null) => (data?.busy ? 2_000 : 10_000);
    renderHook(() => useQuery<{ busy: boolean }>("/api/busy", [], 0, pace));
    await flush();
    expect(calls).toHaveLength(1);

    routes["/api/busy"] = () => ok({ busy: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(calls).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(calls).toHaveLength(3);
  });

  it("does not start a quiet reload while a deliberate load is still on its way, and polls again once it is over", async () => {
    let release!: () => void;
    const slow = new Promise<Response>((resolve) => {
      release = () => resolve(ok(["A"]));
    });
    const calls = stubNetwork({ "/api/slow": () => slow });
    const { result } = renderHook(() => useQuery<string[]>("/api/slow", [], 0, 10_000));
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toEqual(["/api/slow"]);
    expect(result.current.loading).toBe(true);

    release();
    await flush();
    expect(result.current.data).toEqual(["A"]);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toEqual(["/api/slow", "/api/slow"]);
  });

  it("gives up on a load the server never answers, says so, and polls again", async () => {
    let answering = false;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        calls.push(input);
        if (answering) return Promise.resolve(ok(["A"]));
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      })
    );
    const { result } = renderHook(() => useQuery<string[]>("/api/hung", [], 0, 10_000));
    await flush();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("The server did not answer in time");

    answering = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.data).toEqual(["A"]);
    expect(result.current.error).toBeNull();
  });

  it("polls the new url when it moves to one shown from the cache while the previous load never ended", async () => {
    const routes: Record<string, Route> = { "/api/b": () => ok(["B"]), "/api/a": () => new Promise<Response>(() => {}) };
    const calls = stubNetwork(routes);
    const first = renderHook(() => useQuery<string[]>("/api/b", [], 60_000, 10_000));
    await flush();
    first.unmount();
    calls.length = 0;

    const { rerender, result } = renderHook(({ url }) => useQuery<string[]>(url, [], 60_000, 10_000), { initialProps: { url: "/api/a" } });
    await flush();
    expect(result.current.loading).toBe(true);

    rerender({ url: "/api/b" });
    await flush();
    expect(result.current.data).toEqual(["B"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toEqual(["/api/a", "/api/b"]);
  });

  it("asks again at once when the tab becomes visible, not while it is hidden", async () => {
    const routes: Record<string, Route> = { "/api/a": () => ok(["old"]) };
    const calls = stubNetwork(routes);
    const { result } = renderHook(() => useQuery<string[]>("/api/a", [], 0, 60_000));
    await flush();
    expect(calls).toEqual(["/api/a"]);

    routes["/api/a"] = () => ok(["new"]);
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(calls).toEqual(["/api/a"]);

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(calls).toEqual(["/api/a", "/api/a"]);
    expect(result.current.data).toEqual(["new"]);
  });

  it("ignores a reply still in flight for the previous url once a fresh one is shown from the cache", async () => {
    let release!: () => void;
    const gate = new Promise<Response>((resolve) => {
      release = () => resolve(ok(["A"]));
    });
    stubNetwork({ "/api/a": () => gate, "/api/b": () => ok(["B"]) });

    const seed = renderHook(() => useQuery<string[]>("/api/b"));
    await flush();
    expect(seed.result.current.data).toEqual(["B"]);
    seed.unmount();

    const { result, rerender } = renderHook(({ url }) => useQuery<string[]>(url), { initialProps: { url: "/api/a" } });
    rerender({ url: "/api/b" });
    await flush();
    expect(result.current.data).toEqual(["B"]);

    release();
    await flush();
    expect(result.current.data).toEqual(["B"]);
    expect(result.current.dataKey).toBe("/api/b");
  });

  it("stops polling and listening once it is no longer shown", async () => {
    const calls = stubNetwork({ "/api/a": () => ok(["A"]) });
    const { unmount } = renderHook(() => useQuery<string[]>("/api/a", [], 0, 10_000));
    await flush();
    expect(calls).toEqual(["/api/a"]);
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls).toEqual(["/api/a"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
