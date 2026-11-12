import { describe, expect, it } from "vitest";
import { approvalWarnings, failingChecks } from "../services/approval";

describe("failingChecks", () => {
  it("names the check runs and statuses that failed, and ignores those still running or green", () => {
    const rollup = [
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "TIMED_OUT" },
      { __typename: "CheckRun", name: "tests", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "CheckRun", name: "types", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "skipped", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", context: "ci/legacy", state: "ERROR" },
      { __typename: "StatusContext", context: "ci/pending", state: "PENDING" },
    ];
    expect(failingChecks(rollup)).toEqual(["lint", "build", "ci/legacy"]);
  });

  it("reads nothing out of a missing or malformed rollup", () => {
    expect(failingChecks(undefined)).toEqual([]);
    expect(failingChecks([null, "x", {}])).toEqual([]);
  });
});

describe("approvalWarnings", () => {
  it("is empty when every finding was posted, dismissed or resolved and no check failed", () => {
    const findings = [{ state: "posted" }, { state: "dismissed" }, { state: "resolved" }];
    expect(approvalWarnings(findings, [])).toEqual([]);
  });

  it("warns about findings neither posted nor dismissed, and about each failed check", () => {
    const findings = [{ state: "open" }, { state: "open" }, { state: "posted" }];
    expect(approvalWarnings(findings, ["lint"])).toEqual(["2 findings neither posted nor dismissed", "CI check failed: lint"]);
  });

  it("says finding in the singular for one", () => {
    expect(approvalWarnings([{ state: "open" }], [])).toEqual(["1 finding neither posted nor dismissed"]);
  });
});
