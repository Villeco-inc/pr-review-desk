// What the Approve button asks about before approving. It only warns: nothing here blocks an approval.

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);

/** Names of the checks in a `gh pr view --json statusCheckRollup` list that failed; running ones are not failures. */
export function failingChecks(rollup: unknown): string[] {
  if (!Array.isArray(rollup)) return [];
  const names: string[] = [];
  for (const c of rollup) {
    if (!c || typeof c !== "object") continue;
    const check = c as Record<string, unknown>;
    if (FAILED_CONCLUSIONS.has(String(check.conclusion ?? ""))) names.push(String(check.name ?? "?"));
    else if (FAILED_STATES.has(String(check.state ?? ""))) names.push(String(check.context ?? "?"));
  }
  return names;
}

export function approvalWarnings(findings: { state: string }[], failedChecks: string[]): string[] {
  const open = findings.filter((f) => f.state === "open").length;
  const warnings = open > 0 ? [`${open} finding${open > 1 ? "s" : ""} neither posted nor dismissed`] : [];
  return [...warnings, ...failedChecks.map((name) => `CI check failed: ${name}`)];
}
