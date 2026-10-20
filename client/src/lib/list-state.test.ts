import { describe, expect, it } from "vitest";
import { isListLoading } from "./list-state";

const loaded = { repo: "Villeco-inc/linea-web", rowsAreCurrent: true, listLoading: false, failed: false };

describe("isListLoading", () => {
  it("is not loading when no repository is selected", () => {
    expect(isListLoading({ ...loaded, repo: "", rowsAreCurrent: false })).toBe(false);
  });

  it("is loading while a repository has no rows yet, so the empty state cannot flash", () => {
    expect(isListLoading({ ...loaded, rowsAreCurrent: false })).toBe(true);
  });

  it("is not loading once the rows on hand belong to the repository", () => {
    expect(isListLoading(loaded)).toBe(false);
  });

  it("stops loading when the list or its freshness failed, so the error can show", () => {
    expect(isListLoading({ ...loaded, rowsAreCurrent: false, failed: true })).toBe(false);
  });

  it("is loading while a reload runs, even with rows on hand", () => {
    expect(isListLoading({ ...loaded, listLoading: true })).toBe(true);
  });
});
