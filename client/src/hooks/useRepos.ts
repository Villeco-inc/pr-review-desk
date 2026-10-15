import { useSyncExternalStore } from "react";
import { invalidateCache, useQuery } from "./useApi";

// The picked repositories are read by the PR list, the rail and the app shell at once; a new
// pick bumps this version so every reader refetches together.
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reposChanged() {
  invalidateCache("/api/repos");
  version += 1;
  for (const listener of listeners) listener();
}

export function useRepos() {
  const current = useSyncExternalStore(subscribe, () => version);
  return useQuery<string[]>("/api/repos", [current]);
}
