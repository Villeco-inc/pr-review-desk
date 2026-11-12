export const JEV_PRECHECK_KEY = "prd:jev-precheck-threshold";
export const JEV_PRECHECK_DEFAULT = 0.6;

/** Open findings Jev judged to hold at or above `threshold`: checked in advance once a review reports. */
export function jevPrechecked(findings: { id: string; state: string; jevHolds: number | null }[], threshold: number): string[] {
  return findings.filter((f) => f.state === "open" && f.jevHolds !== null && f.jevHolds >= threshold).map((f) => f.id);
}
