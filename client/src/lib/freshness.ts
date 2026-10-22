import type { Freshness } from "../../../shared/types";
import { relativeTime } from "./format";

const POLL_MS = 10_000;
const POLL_WHILE_REFRESHING_MS = 2_000;

/** How soon to ask the server again: quickly while it is refreshing, so the end shows soon. */
export const freshnessPollMs = (freshness: Pick<Freshness, "refreshing"> | null): number =>
  freshness?.refreshing ? POLL_WHILE_REFRESHING_MS : POLL_MS;

/** Data older than the delay the server keeps while someone is looking was missed (a page left aside for hours). A failing refresh is not retried by itself. */
export const needsHardRefresh = (
  { fetchedAt, error, refreshing, activeEveryMs }: Pick<Freshness, "fetchedAt" | "error" | "refreshing" | "activeEveryMs">,
  now: number
): boolean =>
  !!fetchedAt && !error && !refreshing && now - Date.parse(fetchedAt) > activeEveryMs;

/** The line under the pull request list that says how current it is, or null before anything was fetched. */
export function describeFreshness(
  { fetchedAt, error, refreshing }: Pick<Freshness, "fetchedAt" | "error"> & Partial<Pick<Freshness, "refreshing">>,
  now: number
): string | null {
  if (refreshing) return "refreshing…";
  if (error) return fetchedAt ? `refresh failed · data from ${relativeTime(fetchedAt, now)}` : "refresh failed";
  if (!fetchedAt) return null;
  return `refreshed ${relativeTime(fetchedAt, now)}`;
}
