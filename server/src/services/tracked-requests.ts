// What telemetry records: API calls, except the client's own batches and the polls a page repeats every
// few seconds (the pull request list's freshness, the selected repositories), which would bury every
// other event and fill the database, since nothing in telemetry is ever purged. Writes through the same
// paths are still recorded.
const POLLED = new Set(["/api/freshness", "/api/repos"]);

export function isTrackedRequest(method: string, path: string): boolean {
  if (!path.startsWith("/api/") || path === "/api/telemetry/events") return false;
  return !(method === "GET" && POLLED.has(path));
}
