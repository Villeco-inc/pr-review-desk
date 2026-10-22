import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "../lib/api";

interface QueryState<T> {
  data: T | null;
  /** Cache key of the request that produced `data`, so callers can tell stale data from current. */
  dataKey: string | null;
  loading: boolean;
  error: string | null;
}

const queryCache = new Map<string, { data: unknown; ts: number }>();
const DEFAULT_STALE_MS = 30_000;

function cacheKey(url: string): string {
  return url.replace(/[&?]_=\d+/, "");
}

export function invalidateCache(prefix: string) {
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) queryCache.delete(key);
  }
}

/** With `pollMs`, the query reloads quietly on that period while the tab is visible; a function picks the period from the last answer. */
export function useQuery<T>(
  url: string | null,
  deps: unknown[] = [],
  staleMs = DEFAULT_STALE_MS,
  pollMs?: number | ((data: T | null) => number)
) {
  const key = url ? cacheKey(url) : null;
  const cached = key ? queryCache.get(key) : null;

  const [state, setState] = useState<QueryState<T>>({
    data: (cached?.data as T) ?? null,
    dataKey: cached ? key : null,
    loading: url !== null && !cached,
    error: null,
  });
  const requestId = useRef(0);

  const run = useCallback(
    (quiet: boolean) => {
      if (!url) return;
      const id = ++requestId.current;
      if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }));
      fetchJson<T>(url)
        .then((data) => {
          if (requestId.current === id) {
            const k = cacheKey(url);
            queryCache.set(k, { data, ts: Date.now() });
            setState({ data, dataKey: k, loading: false, error: null });
          }
        })
        .catch((err: Error) => {
          // A quiet reload that fails keeps what is on screen; only a deliberate load reports the error.
          if (requestId.current === id && !quiet) setState((prev) => ({ ...prev, loading: false, error: err.message }));
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url]
  );
  const refetch = useCallback(() => run(false), [run]);

  const period = typeof pollMs === "function" ? pollMs(state.data) : pollMs;
  useEffect(() => {
    if (!period || !url) return;
    const reload = () => {
      if (document.visibilityState === "visible") run(true);
    };
    const timer = setInterval(reload, period);
    document.addEventListener("visibilitychange", reload); // back on the tab: ask now, not at the next period
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [period, url, run]);

  useEffect(() => {
    if (cached && Date.now() - cached.ts < staleMs) {
      requestId.current += 1; // a reply still in flight belongs to the previous url
      setState({ data: cached.data as T, dataKey: key, loading: false, error: null });
      return;
    }
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  return { ...state, refetch };
}

export function useMutation<T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST") {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (body?: unknown, overrideUrl?: string): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchJson<T>(overrideUrl ?? url, {
          method,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        setLoading(false);
        return result;
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        setLoading(false);
        throw err;
      }
    },
    [url, method]
  );

  return { mutate, loading, error };
}
