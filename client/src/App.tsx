import { useEffect, useState } from "react";
import { Outlet, useMatches } from "@tanstack/react-router";
import AppShell, { Crumbs, type CrumbItem, type Section } from "./components/AppShell";
import { ToastProvider } from "./components/ui/Toast";
import CommandPalette, { type JumpTarget } from "./components/CommandPalette";
import RepoPicker from "./components/RepoPicker";
import { useRepos } from "./hooks/useRepos";
import { useGo } from "./nav";
import { reviewRepoFromSegment } from "./lib/url-state";

/** The root layout: rail, crumb bar and palette around whichever route is active. */
export default function App() {
  const go = useGo();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: repos } = useRepos();
  // Nothing picked and no REPOS in .env: the PR list has nothing to show until repositories are picked.
  const mustPick = repos !== null && repos.length === 0;
  const leaf = useMatches({ select: (matches) => matches[matches.length - 1] });
  const routeId: string = leaf?.routeId ?? "";
  const params = (leaf?.params ?? {}) as Record<string, string | undefined>;
  const search = (leaf?.search ?? {}) as { branch?: string; base?: string };

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
    if (t.kind === "pick-repos") setPickerOpen(true);
    else if (t.kind === "pr") go.pr(t.repo, t.number);
    else if (t.kind === "finding") go.finding(t.repo, t.number, t.findingId);
    else if (t.kind === "local-review") go.localReview(t);
    else if (t.kind === "local-finding") go.localFinding(t, t.findingId);
    else go.localBranch(t.repoLabel, { branch: t.branch });
  };

  // The section is derived from the path prefix — never stored separately.
  const section: Section = routeId.startsWith("/local") ? "local" : "prs";

  const crumbs: CrumbItem[] = [];
  if (section === "prs") crumbs.push({ label: "Pull requests", onClick: go.prList });
  else crumbs.push({ label: "Local branches", onClick: go.localList });
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
        onNavigate={(s) => (s === "local" ? go.localList() : go.prList())}
        onJump={() => setPaletteOpen(true)}
        onPickRepos={() => setPickerOpen(true)}
      >
        <Outlet />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onJump={jump} />
      {(pickerOpen || mustPick) && <RepoPicker selected={repos ?? []} required={mustPick} onClose={() => setPickerOpen(false)} />}
    </ToastProvider>
  );
}
