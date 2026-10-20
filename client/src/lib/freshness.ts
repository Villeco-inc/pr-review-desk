import type { Freshness } from "../../../shared/types";
import { relativeTime } from "./format";

/** The line under the pull request list that says how current it is, or null before anything was fetched. */
export function describeFreshness({ fetchedAt, error }: Pick<Freshness, "fetchedAt" | "error">, now: number): string | null {
  if (error) return fetchedAt ? `refresh failed · data from ${relativeTime(fetchedAt, now)}` : "refresh failed";
  if (!fetchedAt) return null;
  return `refreshed ${relativeTime(fetchedAt, now)}`;
}
