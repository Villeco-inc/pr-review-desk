import { describe, expect, it } from "vitest";
import { isListLoading, matchRepo, shownError } from "./list-state";

describe("matchRepo", () => {
  const repos = ["Villeco-inc/linea-web", "Villeco-inc/linea-mobile"];

  it("finds the selected repository whatever the case of the name asked for, and gives it as the selection spells it", () => {
    expect(matchRepo("villeco-inc/LINEA-web", repos)).toBe("Villeco-inc/linea-web");
    expect(matchRepo("Villeco-inc/linea-mobile", repos)).toBe("Villeco-inc/linea-mobile");
  });

  it("keeps « all » as it is", () => {
    expect(matchRepo("all", repos)).toBe("all");
  });

  it("finds nothing for a repository that is not selected, or none asked for", () => {
    expect(matchRepo("Villeco-inc/other", repos)).toBeNull();
    expect(matchRepo(undefined, repos)).toBeNull();
    expect(matchRepo("", repos)).toBeNull();
  });
});

const loaded = { repo: "Villeco-inc/linea-web", rowsAreCurrent: true, listLoading: false, failed: false, waitingForRepos: false };

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

  it("is loading until the selection is known, even with no repository to show yet", () => {
    expect(isListLoading({ ...loaded, repo: "", rowsAreCurrent: false, waitingForRepos: true })).toBe(true);
  });

  it("is loading while a reload runs, even with rows on hand", () => {
    expect(isListLoading({ ...loaded, listLoading: true })).toBe(true);
  });
});

describe("shownError", () => {
  const none = { hasRepos: true, reposError: null, listError: null, freshnessError: null, hasFreshness: false };

  it("shows the selection's error while the selection is unknown, since nothing can load without it", () => {
    expect(shownError({ ...none, hasRepos: false, reposError: "Failed to fetch" })).toBe("Failed to fetch");
  });

  it("ignores an old selection error once the selection is known", () => {
    expect(shownError({ ...none, reposError: "Failed to fetch", listError: "gh: HTTP 401" })).toBe("gh: HTTP 401");
  });

  it("shows the freshness error only while no freshness is in hand", () => {
    expect(shownError({ ...none, freshnessError: "Failed to fetch" })).toBe("Failed to fetch");
    expect(shownError({ ...none, freshnessError: "Failed to fetch", hasFreshness: true })).toBeNull();
  });

  it("shows nothing when nothing failed", () => {
    expect(shownError(none)).toBeNull();
  });
});
