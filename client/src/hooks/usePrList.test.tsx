// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateCache } from "./useApi";
import { usePrList } from "./usePrList";

const REPO = "Villeco-inc/linea-web";
const FRESHNESS = `/api/freshness?repo=${encodeURIComponent(REPO)}`;
const PRS = `/api/prs?repo=${encodeURIComponent(REPO)}`;

const freshness = (version: string) => ({ fetchedAt: "2026-10-15T11:59:30Z", error: null, version, refreshing: false, activeEveryMs: 90_000 });
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const failure = () => new Response(JSON.stringify({ error: "Bad Gateway" }), { status: 502 });

type Route = () => Response;

// The network is the only thing replaced: the real fetchJson runs against these answers.
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

const listReads = (calls: string[]) => calls.filter((c) => c === PRS).length;

// Lets the requests and state updates that are already due run to the end: the list is read only once the
// freshness has answered, which takes a few turns.
const flush = async () => {
  for (let turn = 0; turn < 4; turn++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
};
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  invalidateCache("/api/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePrList", () => {
  it("reads the list once its freshness has answered, and again only when the version changes", async () => {
    let version = "v1";
    const calls = stubNetwork({ [FRESHNESS]: () => ok(freshness(version)), [PRS]: () => ok([{ number: 1 }]) });
    const { result } = renderHook(() => usePrList(REPO, 0));
    await flush();
    expect(listReads(calls)).toBe(1);
    expect(result.current.prs).toEqual([{ number: 1 }]);

    await wait(10_000);
    expect(listReads(calls)).toBe(1);

    version = "v2";
    await wait(10_000);
    expect(listReads(calls)).toBe(2);
  });

  it("does not read a list that loaded fine again when a refresh brings the same version", async () => {
    const calls = stubNetwork({ [FRESHNESS]: () => ok(freshness("v1")), [PRS]: () => ok([{ number: 1 }]) });
    const { rerender } = renderHook(({ key }) => usePrList(REPO, key), { initialProps: { key: 0 } });
    await flush();

    rerender({ key: 1 });
    await flush();
    expect(listReads(calls)).toBe(1);
  });

  it("reads a list that failed again when a refresh is asked, even if the version did not change", async () => {
    let answering = false;
    const calls = stubNetwork({ [FRESHNESS]: () => ok(freshness("v1")), [PRS]: () => (answering ? ok([{ number: 1 }]) : failure()) });
    const { result, rerender } = renderHook(({ key }) => usePrList(REPO, key), { initialProps: { key: 0 } });
    await flush();
    expect(result.current.listError).toBe("Bad Gateway");

    answering = true;
    rerender({ key: 1 });
    await flush();
    expect(listReads(calls)).toBe(2);
    expect(result.current.listError).toBeNull();
    expect(result.current.prs).toEqual([{ number: 1 }]);
  });

  it("tries a list that failed again by itself, without waiting for the version to change", async () => {
    let answering = false;
    stubNetwork({ [FRESHNESS]: () => ok(freshness("v1")), [PRS]: () => (answering ? ok([{ number: 1 }]) : failure()) });
    const { result } = renderHook(() => usePrList(REPO, 0));
    await flush();
    expect(result.current.listError).toBe("Bad Gateway");

    answering = true;
    await wait(10_000);
    expect(result.current.listError).toBeNull();
    expect(result.current.prs).toEqual([{ number: 1 }]);
  });
});
