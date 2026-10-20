import { describe, expect, it } from "vitest";
import { describeFreshness } from "./freshness";

const NOON = Date.parse("2026-10-15T12:00:00Z");

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
});
