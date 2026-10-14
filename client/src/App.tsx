import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatches } from "@tanstack/react-router";
import AppShell, { Crumbs, type CrumbItem, type Section } from "./components/AppShell";
import { ToastProvider } from "./components/ui/Toast";
import CommandPalette, { type JumpTarget } from "./components/CommandPalette";
import { useGo } from "./nav";
import { compareRepoFromSegment, reviewRepoFromSegment } from "./lib/url-state";
import { trackScreen } from "./lib/telemetry";
import { useReviewNotifications } from "./hooks/useReviewNotifications";

/** The root layout: rail, crumb bar and palette around whichever route is active. */
export default function App() {
  const go = useGo();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const leaf = useMatches({ select: (matches) => matches[matches.length - 1] });
  const routeId: string = leaf?.routeId ?? "";
  const params = (leaf?.params ?? {}) as Record<string, string | undefined>;
  const search = (leaf?.search ?? {}) as { branch?: string; base?: string; head?: string };
  const location = useLocation();
  useReviewNotifications();

  useEffect(() => {
    trackScreen(location.pathname, location.searchStr, routeId);
  }, [location.pathname, location.searchStr, routeId]);

  // ⌘K / Ctrl+K works everywhere, including inside fields, like every other jump-to palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const jump = (t: JumpTarget) => {
    if (t.kind === "pr") go.pr(t.repo, t.number);
    else if (t.kind === "finding") go.finding(t.repo, t.number, t.findingId);
    else if (t.kind === "local-review") go.localReview(t);
    else if (t.kind === "local-finding") go.localFinding(t, t.findingId);
    else go.localBranch(t.repoLabel, { branch: t.branch });
  };

  // The section is derived from the path prefix — never stored separately.
  const section: Section = routeId.startsWith("/local")
    ? "local"
    : routeId.startsWith("/compare")
      ? "compare"
      : routeId.startsWith("/activity")
        ? "activity"
        : "prs";

  const crumbs: CrumbItem[] = [];
  if (section === "prs") crumbs.push({ label: "Pull requests", onClick: go.prList });
  else if (section === "local") crumbs.push({ label: "Local branches", onClick: go.localList });
  else if (section === "compare") crumbs.push({ label: "Compare", onClick: go.compareList });
  else crumbs.push({ label: "Activity", onClick: () => go.activity() });
  if (section === "compare" && params.owner && params.repo) {
    const ghRepo = `${params.owner}/${params.repo}`;
    crumbs.push({ label: params.repo, mono: true, onClick: () => go.compare(ghRepo, { head: search.head, base: search.base }) });
    if (params.reviewRepo) {
      const ref = { repo: compareRepoFromSegment(params.reviewRepo), number: Number(params.number), ghRepo, base: search.base ?? "", head: search.head ?? "" };
      crumbs.push({ label: `${ref.head || "head"} vs ${ref.base || "base"}`, mono: true, onClick: () => go.compareReview(ref) });
    }
  }
  if (routeId.startsWith("/prs/$owner") && params.owner && params.repo) {
    const repo = `${params.owner}/${params.repo}`;
    const number = Number(params.number);
    crumbs.push({ label: `${params.repo} #${params.number}`, mono: true, onClick: () => go.pr(repo, number) });
  }
  if (routeId.startsWith("/local/$label/reviews") && params.label && params.reviewRepo) {
    const ref = {
      repo: reviewRepoFromSegment(params.reviewRepo),
      number: Number(params.number),
      repoLabel: params.label,
      branch: search.branch ?? "",
      base: search.base ?? "",
    };
    crumbs.push({ label: `${ref.repoLabel} · ${ref.branch || "review"}`, mono: true, onClick: () => go.localReview(ref) });
  }
  if (routeId.endsWith("/findings/$findingId")) crumbs.push({ label: "Finding" });
  if (routeId.endsWith("/runs/$runId")) crumbs.push({ label: "Session" });

  return (
    <ToastProvider>
      <AppShell
        section={section}
        crumbs={<Crumbs items={crumbs} />}
        onNavigate={(s) => (s === "local" ? go.localList() : s === "compare" ? go.compareList() : s === "activity" ? go.activity() : go.prList())}
        onJump={() => setPaletteOpen(true)}
      >
        <Outlet />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onJump={jump} />
    </ToastProvider>
  );
}
