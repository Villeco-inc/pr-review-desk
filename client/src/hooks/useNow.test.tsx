// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

const NOON = Date.parse("2026-10-15T12:00:00Z");

afterEach(() => {
  cleanup(); // no globals here, so nothing unmounts the hooks of a finished test by itself
  vi.useRealTimers();
});

describe("useNow", () => {
  it("renews the time on its period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
    const { result } = renderHook(() => useNow(10_000));
    expect(result.current).toBe(NOON);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(NOON + 10_000);
  });

  it("renews the time as soon as the tab comes back, without waiting for the period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
    const { result } = renderHook(() => useNow(10_000));

    vi.setSystemTime(NOON + 4_000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(NOON + 4_000);
  });

  it("stops renewing once it is no longer shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
    const { result, unmount } = renderHook(() => useNow(10_000));
    unmount();

    vi.setSystemTime(NOON + 60_000);
    act(() => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(NOON);
    expect(vi.getTimerCount()).toBe(0);
  });
});
