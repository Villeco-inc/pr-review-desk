import { describe, expect, it } from "vitest";
import { parsePrInput } from "./pr-input";

describe("parsePrInput", () => {
  it("reads a GitHub pull request address, with or without what follows the number", () => {
    expect(parsePrInput("https://github.com/acme/api/pull/655", [])).toEqual({ repo: "acme/api", number: 655 });
    expect(parsePrInput("  github.com/acme/api/pull/655/files?diff=split#r1 ", [])).toEqual({ repo: "acme/api", number: 655 });
  });

  it("reads owner/repo#number", () => {
    expect(parsePrInput("acme/api#655", ["autre/api"])).toEqual({ repo: "acme/api", number: 655 });
  });

  it("finds the owner of repo#number among the followed repositories", () => {
    expect(parsePrInput("api#655", ["acme/web", "acme/api", "org:acme"])).toEqual({ repo: "acme/api", number: 655 });
    expect(parsePrInput("API#655", ["acme/api"])).toEqual({ repo: "acme/api", number: 655 });
  });

  it("asks for the owner when several followed repositories share the name", () => {
    expect(parsePrInput("api#655", ["acme/api", "autre/api"])).toEqual({
      error: "Several followed repositories are named api (acme/api, autre/api). Type owner/api#655.",
    });
  });

  it("says so when no followed repository has that name", () => {
    expect(parsePrInput("web#12", ["acme/api"])).toEqual({ error: "No followed repository is named web. Paste the pull request's address instead." });
  });

  it("refuses anything that is not a pull request", () => {
    const error = "Not a pull request. Paste its GitHub address, or type repo#123.";
    expect(parsePrInput("allo", ["acme/api"])).toEqual({ error });
    expect(parsePrInput("https://github.com/acme/api/issues/655", ["acme/api"])).toEqual({ error });
    expect(parsePrInput("https://example.com/acme/api/pull/655", ["acme/api"])).toEqual({ error });
    expect(parsePrInput("api#0", ["acme/api"])).toEqual({ error });
  });
});
