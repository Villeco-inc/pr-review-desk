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

export function useQuery<T>(url: string | null, deps: unknown[] = [], staleMs = DEFAULT_STALE_MS) {
  const key = url ? cacheKey(url) : null;
  const cached = key ? queryCache.get(key) : null;

  const [state, setState] = useState<QueryState<T>>({
    data: (cached?.data as T) ?? null,
    dataKey: cached ? key : null,
    loading: url !== null && !cached,
    error: null,
  });
  const requestId = useRef(0);

  const refetch = useCallback(() => {
    if (!url) return;
    const id = ++requestId.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchJson<T>(url)
      .then((data) => {
        if (requestId.current === id) {
          const k = cacheKey(url);
          queryCache.set(k, { data, ts: Date.now() });
          setState({ data, dataKey: k, loading: false, error: null });
        }
      })
      .catch((err: Error) => {
        if (requestId.current === id) setState((prev) => ({ ...prev, loading: false, error: err.message }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (cached && Date.now() - cached.ts < staleMs) {
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
