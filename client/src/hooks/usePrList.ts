import { useEffect, useRef } from "react";
import type { Freshness, PullRequestDto } from "../../../shared/types";
import { freshnessPollMs } from "../lib/freshness";
import { useQuery } from "./useApi";

const RETRY_FAILED_LIST_MS = 10_000;

/**
 * The cheap question comes first: the list is loaded once its freshness has answered, and again whenever the
 * server's data or the reviews on it changed (the version), quietly since the rows on screen are still good. A
 * list that failed does not wait for that: the version stays the same when GitHub gives the same pull requests,
 * so it is tried again by itself, and at once when a refresh is asked.
 */
export function usePrList(repo: string, refreshKey: number) {
  const freshnessKey = repo ? `/api/freshness?repo=${encodeURIComponent(repo)}` : null;
  const { data, dataKey, error: freshnessError } = useQuery<Freshness>(freshnessKey, [repo, refreshKey], 0, freshnessPollMs);
  const freshness = data && dataKey === freshnessKey ? data : null;

  const prsKey = repo ? `/api/prs?repo=${encodeURIComponent(repo)}` : null;
  const list = useQuery<PullRequestDto[]>(
    freshness ? prsKey : null,
    [repo],
    0,
    (_data, error) => (error ? RETRY_FAILED_LIST_MS : 0),
    [freshness?.version]
  );

  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    if (list.error) list.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return { freshnessKey, freshness, freshnessError, prsKey, prs: list.data, dataKey: list.dataKey, listLoading: list.loading, listError: list.error };
}
