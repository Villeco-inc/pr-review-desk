import { useEffect, useState } from "react";

/** The current time, renewed on a period and when the tab comes back, so an age on screen keeps growing even if nothing else renders. */
export function useNow(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const renew = () => setNow(Date.now());
    const timer = setInterval(renew, periodMs);
    document.addEventListener("visibilitychange", renew);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [periodMs]);
  return now;
}
