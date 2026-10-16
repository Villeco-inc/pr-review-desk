import { describe, expect, it } from "vitest";
import { describePrListError } from "./github-errors";

describe("describePrListError", () => {
  it("sends an expired or missing token back to ./start.sh, not to .env", () => {
    const hint = "GitHub is not authenticated: run ./start.sh again. It reconnects gh when needed.";
    expect(describePrListError("HTTP 401: Bad credentials (https://api.github.com/graphql)")).toBe(hint);
    expect(describePrListError("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable")).toBe(hint);
  });

  it("shows any other error as it came", () => {
    expect(describePrListError("GraphQL: Could not resolve to a Repository with the name 'villeco/villeco'. (repository)")).toBe(
      "GraphQL: Could not resolve to a Repository with the name 'villeco/villeco'. (repository)"
    );
  });
});
