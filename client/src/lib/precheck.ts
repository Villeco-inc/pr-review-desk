export const JEV_PRECHECK_KEY = "prd:jev-precheck-threshold";
export const JEV_PRECHECK_DEFAULT = 0.6;

/** Open findings Jev judged to hold at or above `threshold`: checked in advance once a review reports. */
export function jevPrechecked(findings: { id: string; state: string; jevHolds: number | null }[], threshold: number): string[] {
  return findings.filter((f) => f.state === "open" && f.jevHolds !== null && f.jevHolds >= threshold).map((f) => f.id);
}

/** What the home screen's Post button posts: while Jev is on, only what it holds; while it is off, every open finding. */
export function findingsToPost(open: { id: string; jevHolds: number | null }[], jevEnabled: boolean, threshold: number): string[] {
  return jevEnabled ? jevPrechecked(open.map((f) => ({ ...f, state: "open" })), threshold) : open.map((f) => f.id);
}
