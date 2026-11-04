import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetLocalRepo,
  loadCompareHead,
  loadPrFilters,
  loadPrOrder,
  parseSearch,
  rememberedCompareRepo,
  rememberedLocalRepo,
  rememberedPrList,
  reviewRepoFromSegment,
  reviewRepoSegment,
  saveCompare,
  saveLocalSelection,
  savePrList,
  savePrOrder,
  stringifySearch,
  validatePrListSearch,
} from "./url-state";
import { resetViewMemory } from "./view-memory";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
  resetViewMemory();
});

describe("search round trip", () => {
  it("keeps repeated keys as lists and values with commas intact", () => {
    const search = { repo: "org:acme", label: ["needs review", "a,b"], sort: "updated" };
    const parsed = validatePrListSearch(parseSearch(stringifySearch(search)));
    expect(parsed).toEqual({ ...search, author: undefined, status: undefined, dir: undefined });
  });

  it("drops empty values and unknown enum members", () => {
    expect(stringifySearch({ repo: "", author: [], sort: undefined })).toBe("");
    expect(validatePrListSearch({ status: ["draft", "bogus"], sort: "size", dir: "up" })).toEqual({
      repo: undefined,
      author: undefined,
      status: ["draft"],
      label: undefined,
      sort: undefined,
      dir: undefined,
    });
  });

  it("treats a single value as a one-item list", () => {
    expect(validatePrListSearch(parseSearch("?author=alice")).author).toEqual(["alice"]);
  });
});

describe("list memory", () => {
  it("restores the last repo with that repo's own filters", () => {
    savePrList({ repo: "acme/api", label: ["bug"], sort: "updated" });
    savePrList({ repo: "acme/web", author: ["bob"] });
    expect(rememberedPrList()).toEqual({ repo: "acme/web", ...loadPrFilters("acme/web") });
    expect(loadPrFilters("acme/api")).toMatchObject({ label: ["bug"], sort: "updated" });
    expect(loadPrFilters("acme/api").author).toBeUndefined();
  });

  it("remembers nothing until a repo is chosen", () => {
    expect(rememberedPrList()).toBeNull();
  });

  it("forgets a local repo so /local stops redirecting to it", () => {
    saveLocalSelection("api", { branch: "feat/x", base: "main" });
    expect(rememberedLocalRepo()).toBe("api");
    forgetLocalRepo("api");
    expect(rememberedLocalRepo()).toBeNull();
  });
});

describe("compare memory", () => {
  it("restores the last repository with that repository's own head", () => {
    saveCompare("Villeco-inc/linea-web", "feat/x");
    saveCompare("Villeco-inc/linea-mobile", "feat/y");
    expect(rememberedCompareRepo()).toBe("Villeco-inc/linea-mobile");
    expect(loadCompareHead("Villeco-inc/linea-web")).toBe("feat/x");
    expect(loadCompareHead("Villeco-inc/linea-mobile")).toBe("feat/y");
  });

  it("remembers nothing until a repository is chosen, and keeps a head when saved again without one", () => {
    expect(rememberedCompareRepo()).toBeNull();
    expect(loadCompareHead("Villeco-inc/linea-web")).toBeUndefined();

    saveCompare("Villeco-inc/linea-web", "feat/x");
    saveCompare("Villeco-inc/linea-web", undefined);
    expect(loadCompareHead("Villeco-inc/linea-web")).toBe("feat/x");
  });

  it("keeps no copy in the browser, so that resetting the data resets it too", () => {
    saveCompare("Villeco-inc/linea-web", "feat/x");
    const storage = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
    expect(storage.getItem("prd:compare:repo")).toBeNull();
    expect(storage.getItem("prd:compare:head:Villeco-inc/linea-web")).toBeNull();
  });
});

describe("pager order and local ids", () => {
  it("keeps only well-formed entries", () => {
    savePrOrder([{ repo: "a/b", number: 1 }]);
    expect(loadPrOrder()).toEqual([{ repo: "a/b", number: 1 }]);
  });

  it("maps local review repos to a slash-free segment and back", () => {
    expect(reviewRepoSegment("local/api-9f2c1a0b3d")).toBe("api-9f2c1a0b3d");
    expect(reviewRepoFromSegment("api-9f2c1a0b3d")).toBe("local/api-9f2c1a0b3d");
  });
});
