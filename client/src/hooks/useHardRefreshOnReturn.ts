import { useEffect, useRef } from "react";
import type { Freshness } from "../../../shared/types";
import { fetchJson } from "../lib/api";
import { needsHardRefresh } from "../lib/freshness";

/**
 * Once the page is shown, and each time the tab comes back, asks the server how current its data are and calls
 * `refresh` when they are older than the delay it keeps. It decides on that answer, never on what the page saw
 * before leaving: the server may have refreshed since.
 */
export function useHardRefreshOnReturn(freshnessKey: string | null, refresh: () => void, busy: boolean): void {
  const latest = useRef({ refresh, busy });
  latest.current = { refresh, busy };
  const asked = useRef(0);

  useEffect(() => {
    if (!freshnessKey) return;
    const check = () => {
      const id = ++asked.current;
      fetchJson<Freshness>(freshnessKey)
        .then((freshness) => {
          if (asked.current === id && !latest.current.busy && needsHardRefresh(freshness, Date.now())) latest.current.refresh();
        })
        .catch(() => {});
    };
    const back = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    document.addEventListener("visibilitychange", back);
    return () => {
      asked.current++; // an answer still on its way belongs to a page that is gone
      document.removeEventListener("visibilitychange", back);
    };
  }, [freshnessKey]);
}
