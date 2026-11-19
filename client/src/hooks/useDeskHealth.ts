import { useEffect, useState } from "react";
import type { DeskHealth } from "../../../shared/types";
import { fetchJson } from "../lib/api";

/** Reads /api/health once on mount. A failed read stays null: the marks are decoration, never an error. */
export function useDeskHealth(): DeskHealth | null {
  const [health, setHealth] = useState<DeskHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJson<DeskHealth>("/api/health")
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return health;
}
