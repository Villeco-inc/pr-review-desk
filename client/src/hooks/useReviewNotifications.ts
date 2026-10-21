import { useCallback, useState } from "react";
import { useSSE } from "./useSSE";
import { useGo } from "../nav";
import type { ReviewOutcome } from "../../../shared/types";

const supported = typeof window !== "undefined" && "Notification" in window;

export function useNotificationPermission(): [NotificationPermission | "unsupported", () => void] {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(supported ? Notification.permission : "unsupported");
  const request = useCallback(() => {
    void Notification.requestPermission().then(setPermission);
  }, []);
  return [permission, request];
}

/** One system notification per review that finishes or fails; a click opens it. */
export function useReviewNotifications() {
  const go = useGo();

  useSSE(supported ? "/api/reviews/outcomes" : null, (data) => {
    if (Notification.permission !== "granted") return;
    const outcome = data as ReviewOutcome;
    const body =
      outcome.status === "reported"
        ? `Review finished — ${outcome.findings ?? 0} finding${outcome.findings === 1 ? "" : "s"}`
        : `Review failed — ${outcome.error ?? "unknown error"}`;
    // Same tag in every open tab: the system keeps one notification instead of stacking copies.
    const notification = new Notification(outcome.title, { body, tag: `${outcome.reviewId}:${outcome.status}` });
    notification.onclick = () => {
      window.focus();
      notification.close();
      const target = outcome.target;
      if (target?.kind === "pr") go.pr(target.repo, target.number);
      else if (target?.kind === "local") go.localReview(target);
      else if (target?.kind === "compare") go.compareReview(target);
    };
  });
}
