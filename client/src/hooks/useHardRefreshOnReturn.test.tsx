// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHardRefreshOnReturn } from "./useHardRefreshOnReturn";

const NOON = Date.parse("2026-10-15T12:00:00Z");
const KEY = "/api/freshness?repo=Villeco-inc/linea-web";

type Answer = { fetchedAt: string | null; error: string | null; version: string; refreshing: boolean; activeEveryMs: number };
const answer = (over: Partial<Answer> = {}): Answer => ({
  fetchedAt: "2026-10-15T11:59:30Z",
  error: null,
  version: "v",
  refreshing: false,
  activeEveryMs: 90_000,
  ...over,
});
const sixteenHoursOld = { fetchedAt: "2026-10-14T20:00:00Z" };

// The network is the only thing replaced: the real fetchJson runs against this answer.
function stubFreshness(next: () => Promise<Answer> | Answer) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(await next()), { status: 200 });
    })
  );
  return asked;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

const comeBack = async () => {
  setVisibility("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
};

// Lets the requests and state updates that are already due run to the end.
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useHardRefreshOnReturn", () => {
  it("asks the server once the page is shown, and refreshes when its data is older than the delay it keeps", async () => {
    const asked = stubFreshness(() => answer(sixteenHoursOld));
    const refresh = vi.fn();
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    expect(asked).toEqual([KEY]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the data alone when the server's own are recent", async () => {
    stubFreshness(() => answer());
    const refresh = vi.fn();
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("decides on what the server says when the tab comes back, not on what the page saw before it left", async () => {
    let current = answer();
    const asked = stubFreshness(() => current);
    const refresh = vi.fn();
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    vi.setSystemTime(NOON + 5 * 60_000);
    current = answer({ fetchedAt: "2026-10-15T12:04:50Z" });
    await comeBack();
    expect(asked).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();

    vi.setSystemTime(NOON + 60 * 60_000);
    current = answer({ fetchedAt: "2026-10-15T12:04:50Z" });
    await comeBack();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask anything while the tab is hidden", async () => {
    const asked = stubFreshness(() => answer());
    renderHook(() => useHardRefreshOnReturn(KEY, vi.fn(), false));
    await flush();

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(asked).toHaveLength(1);
  });

  it("does not refresh when the server is already on it, when its last refresh failed, or when one is under way here", async () => {
    const refresh = vi.fn();
    stubFreshness(() => answer({ ...sixteenHoursOld, refreshing: true }));
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    stubFreshness(() => answer({ ...sixteenHoursOld, error: "gh: HTTP 403" }));
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    stubFreshness(() => answer(sixteenHoursOld));
    renderHook(() => useHardRefreshOnReturn(KEY, refresh, true));
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores an answer that comes after the page was closed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFreshness(async () => {
      await gate;
      return answer(sixteenHoursOld);
    });
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useHardRefreshOnReturn(KEY, refresh, false));
    await flush();

    unmount();
    release();
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores the answer about a repository the page has since left", async () => {
    const other = "/api/freshness?repo=Villeco-inc/villeco";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFreshness(async () => {
      await gate;
      return answer(sixteenHoursOld);
    });
    const refresh = vi.fn();
    const { rerender } = renderHook(({ key }) => useHardRefreshOnReturn(key, refresh, false), { initialProps: { key: KEY } });
    await flush();

    stubFreshness(() => answer());
    rerender({ key: other });
    await flush();
    release();
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });
});
