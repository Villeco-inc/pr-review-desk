import { describe, expect, it } from "vitest";
import { describeFreshness, freshnessPollMs, needsHardRefresh } from "./freshness";

const NOON = Date.parse("2026-10-15T12:00:00Z");
const fresh = { fetchedAt: "2026-10-15T11:59:00Z", error: null, refreshing: false, activeEveryMs: 90_000 };

describe("describeFreshness", () => {
  it("says how long ago the data was fetched", () => {
    expect(describeFreshness({ fetchedAt: "2026-10-15T11:58:00Z", error: null }, NOON)).toBe("refreshed 2m ago");
  });

  it("says just now within the first minute", () => {
    expect(describeFreshness({ fetchedAt: "2026-10-15T11:59:40Z", error: null }, NOON)).toBe("refreshed just now");
  });

  it("owns up to a failed refresh and says how old the data is", () => {
    expect(describeFreshness({ fetchedAt: "2026-10-15T11:55:00Z", error: "gh: HTTP 401" }, NOON)).toBe("refresh failed · data from 5m ago");
  });

  it("says only that the refresh failed when nothing was ever fetched", () => {
    expect(describeFreshness({ fetchedAt: null, error: "gh: HTTP 401" }, NOON)).toBe("refresh failed");
  });

  it("says nothing before the first fetch", () => {
    expect(describeFreshness({ fetchedAt: null, error: null }, NOON)).toBeNull();
  });

  it("says the data is being refreshed rather than how old it is, even after a failed refresh", () => {
    expect(describeFreshness({ fetchedAt: "2026-10-14T20:00:00Z", error: null, refreshing: true }, NOON)).toBe("refreshing…");
    expect(describeFreshness({ fetchedAt: "2026-10-14T20:00:00Z", error: "gh: HTTP 401", refreshing: true }, NOON)).toBe("refreshing…");
    expect(describeFreshness({ fetchedAt: null, error: null, refreshing: true }, NOON)).toBe("refreshing…");
  });
});

describe("needsHardRefresh", () => {
  it("is true once the data is older than the delay the server keeps while someone is looking", () => {
    expect(needsHardRefresh({ ...fresh, fetchedAt: "2026-10-15T11:58:29Z" }, NOON)).toBe(true);
  });

  it("is false while the data is no older than that delay", () => {
    expect(needsHardRefresh({ ...fresh, fetchedAt: "2026-10-15T11:58:30Z" }, NOON)).toBe(false);
  });

  it("is false when the server is already refreshing, so it is not asked twice", () => {
    expect(needsHardRefresh({ ...fresh, fetchedAt: "2026-10-14T20:00:00Z", refreshing: true }, NOON)).toBe(false);
  });

  it("is false after a failed refresh, which would otherwise be asked again at every return", () => {
    expect(needsHardRefresh({ ...fresh, fetchedAt: "2026-10-14T20:00:00Z", error: "gh: HTTP 403" }, NOON)).toBe(false);
  });

  it("is false when nothing was ever fetched, since reading the list fetches it", () => {
    expect(needsHardRefresh({ ...fresh, fetchedAt: null }, NOON)).toBe(false);
  });

  it("follows the delay the server announces", () => {
    const fetchedAt = "2026-10-15T11:55:00Z";
    expect(needsHardRefresh({ ...fresh, fetchedAt, activeEveryMs: 600_000 }, NOON)).toBe(false);
    expect(needsHardRefresh({ ...fresh, fetchedAt, activeEveryMs: 60_000 }, NOON)).toBe(true);
  });
});

describe("freshnessPollMs", () => {
  it("asks every ten seconds in the ordinary case", () => {
    expect(freshnessPollMs(fresh)).toBe(10_000);
    expect(freshnessPollMs(null)).toBe(10_000);
  });

  it("asks within three seconds while the server is refreshing, so the end shows soon", () => {
    const poll = freshnessPollMs({ ...fresh, refreshing: true });
    expect(poll).toBeGreaterThanOrEqual(1_000);
    expect(poll).toBeLessThanOrEqual(3_000);
  });
});
