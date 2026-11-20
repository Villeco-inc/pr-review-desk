import { useEffect } from "react";
import type { DeskHealth } from "../../../shared/types";

const BASE_TITLE = "PR Review Desk";

/** Striped orange banner that makes a dev Desk unmistakable. Renders nothing in prod or before health is known. */
export default function DevBanner({ health }: { health: DeskHealth | null }) {
  const isDev = health?.mode === "dev";
  useEffect(() => {
    if (!isDev) return;
    document.title = `[DEV] ${BASE_TITLE}`;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [isDev]);

  if (!health || !isDev) return null;
  return (
    <div
      role="status"
      className="shrink-0 py-1 text-center text-[11px] font-bold text-[#2b1a00]"
      style={{ background: "repeating-linear-gradient(135deg, #f5a623 0 12px, #f7b84a 12px 24px)" }}
    >
      {`MODE DEV · branche ${health.branch ?? "inconnue"} · serveur :${health.port}`}
    </div>
  );
}

/** Small orange « DEV » pill for the rail, beside the app title. */
export function DevPill({ health }: { health: DeskHealth | null }) {
  if (health?.mode !== "dev") return null;
  return <span className="ml-auto self-start bg-[#f5a623] px-1.5 text-[10px] font-bold leading-4 text-[#2b1a00]">DEV</span>;
}
