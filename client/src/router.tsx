// The URL is the source of truth for which screen is showing and for its list filters.
// Each page below only translates between the route and the screen's props.

import { useEffect } from "react";
import { createRootRoute, createRoute, createRouter, redirect, useNavigate } from "@tanstack/react-router";
import App from "./App";
import PRList from "./components/PRList";
import PRDetail from "./components/PRDetail";
import FindingDetail from "./components/FindingDetail";
import LocalBranches from "./components/LocalBranches";
import LocalReviewDetail from "./components/LocalReviewDetail";
import RunSession from "./components/RunSession";
import CompareView from "./components/CompareView";
import ActivityView, { type ActivitySearch } from "./components/ActivityView";
import { useQuery } from "./hooks/useApi";
import NotFound from "./components/ui/NotFound";
import { useGo } from "./nav";
import {
  compareRepoFromSegment,
  forgetLocalRepo,
  isEmptySearch,
  loadCompareHead,
  rememberedCompareRepo,
  saveCompare,
  validateCompareSearch,
  loadLocalSelection,
  loadPrFilters,
  parseSearch,
  rememberedLocalRepo,
  rememberedPrList,
  reviewRepoFromSegment,
  saveLocalSelection,
  savePrList,
  stringifySearch,
  validateLocalSearch,
  validatePrListSearch,
  type CompareSearch,
  type LocalSearch,
  type PrListSearch,
} from "./lib/url-state";
import type { CompareReviewRef } from "./nav";

const rootRoute = createRootRoute({ component: App, notFoundComponent: UnknownPath });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/prs", replace: true });
  },
});

// ── Pull requests ─────────────────────────────────────────────────────────────

const prListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prs",
  validateSearch: validatePrListSearch,
  // A bare /prs (rail, crumb, back) picks up the last repo and that repo's filters.
  beforeLoad: ({ search }) => {
    if (!isEmptySearch(search)) return;
    const remembered = rememberedPrList();
    if (remembered) throw redirect({ to: "/prs", search: remembered, replace: true });
  },
  component: PrListPage,
});

function PrListPage() {
  const search = prListRoute.useSearch();
  const navigate = useNavigate();
  const go = useGo();
  useEffect(() => savePrList(search), [search]);
  // Filter changes replace the history entry: Back leaves the screen instead of undoing a click.
  const setSearch = (next: PrListSearch) => navigate({ to: "/prs", search: next, replace: true });
  return (
    <PRList
      search={search}
      onSearchChange={setSearch}
      onRepoChange={(repo) => setSearch({ repo, ...loadPrFilters(repo) })}
      onSelectPR={go.pr}
    />
  );
}

const prRoute = createRoute({ getParentRoute: () => rootRoute, path: "/prs/$owner/$repo/$number", component: PrPage });

function prParams(params: { owner: string; repo: string; number: string }) {
  return { repo: `${params.owner}/${params.repo}`, number: Number(params.number), valid: /^\d+$/.test(params.number) };
}

function PrPage() {
  const params = prRoute.useParams();
  const { repo, number, valid } = prParams(params);
  const go = useGo();
  if (!valid) return <NotFound title="Pull request not found" detail={`"${params.number}" is not a pull request number.`} backLabel="Back to pull requests" onBack={go.prList} />;
  return (
    <PRDetail
      key={`${repo}#${number}`}
      repo={repo}
      number={number}
      onSelectPR={go.pr}
      onBack={go.prList}
      onSelectFinding={(findingId) => go.finding(repo, number, findingId)}
      onOpenSession={(runId) => go.session(repo, number, runId)}
    />
  );
}

const findingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prs/$owner/$repo/$number/findings/$findingId",
  component: FindingPage,
});

function FindingPage() {
  const params = findingRoute.useParams();
  const { repo, number, valid } = prParams(params);
  const go = useGo();
  if (!valid) return <NotFound title="Finding not found" backLabel="Back to pull requests" onBack={go.prList} />;
  return (
    <FindingDetail
      key={params.findingId}
      findingId={params.findingId}
      repo={repo}
      number={number}
      onBack={() => go.pr(repo, number)}
      onSelectFinding={(findingId) => go.finding(repo, number, findingId)}
    />
  );
}

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prs/$owner/$repo/$number/runs/$runId",
  component: SessionPage,
});

function SessionPage() {
  const params = sessionRoute.useParams();
  const { repo, number } = prParams(params);
  const go = useGo();
  return (
    <RunSession
      repo={repo}
      number={number}
      runId={params.runId}
      onSelectRun={(runId) => go.session(repo, number, runId, { replace: true })}
      onBack={() => go.pr(repo, number)}
      backLabel="Back to pull request"
    />
  );
}

// ── Local branches ────────────────────────────────────────────────────────────

const localIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local",
  // A bare /local goes back to the last local repo with its branch pair.
  beforeLoad: () => {
    const label = rememberedLocalRepo();
    if (label) throw redirect({ to: "/local/$label", params: { label }, search: loadLocalSelection(label), replace: true });
  },
  component: () => <LocalListPage />,
});

const localListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local/$label",
  validateSearch: validateLocalSearch,
  beforeLoad: ({ params, search }) => {
    if (!isEmptySearch(search)) return;
    const remembered = loadLocalSelection(params.label);
    if (!isEmptySearch(remembered)) throw redirect({ to: "/local/$label", params, search: remembered, replace: true });
  },
  component: () => <LocalListPage label={localListRoute.useParams().label} search={localListRoute.useSearch()} />,
});

function LocalListPage({ label, search = {} }: { label?: string; search?: LocalSearch }) {
  const navigate = useNavigate();
  const go = useGo();
  const show = (l: string, next: LocalSearch) => navigate({ to: "/local/$label", params: { label: l }, search: next, replace: true });
  return (
    <LocalBranches
      label={label}
      search={search}
      onRepoChange={(l) => show(l, loadLocalSelection(l))}
      onSelectionChange={(next) => label && show(label, next)}
      onRemember={saveLocalSelection}
      onForgetRepo={forgetLocalRepo}
      onSelectReview={go.localReview}
    />
  );
}

const localReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local/$label/reviews/$reviewRepo/$number",
  validateSearch: validateLocalSearch,
  component: LocalReviewPage,
});

function localReviewRef(params: { label: string; reviewRepo: string; number: string }, search: LocalSearch) {
  return {
    repo: reviewRepoFromSegment(params.reviewRepo),
    number: Number(params.number),
    repoLabel: params.label,
    branch: search.branch ?? "",
    base: search.base ?? "",
  };
}

function LocalReviewPage() {
  const ref = localReviewRef(localReviewRoute.useParams(), localReviewRoute.useSearch());
  const go = useGo();
  return (
    <LocalReviewDetail
      key={`${ref.repo}#${ref.number}`}
      {...ref}
      // Back lands on the same branch pair the review was run for.
      onBack={() => go.localBranch(ref.repoLabel, { branch: ref.branch || undefined, base: ref.base || undefined })}
      onSelectFinding={(findingId) => go.localFinding(ref, findingId)}
      onOpenSession={(runId) => go.localSession(ref, runId)}
    />
  );
}

const localFindingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local/$label/reviews/$reviewRepo/$number/findings/$findingId",
  validateSearch: validateLocalSearch,
  component: LocalFindingPage,
});

function LocalFindingPage() {
  const params = localFindingRoute.useParams();
  const ref = localReviewRef(params, localFindingRoute.useSearch());
  const go = useGo();
  return (
    <FindingDetail
      key={params.findingId}
      findingId={params.findingId}
      repo={ref.repo}
      number={ref.number}
      readOnly
      onBack={() => go.localReview(ref)}
      onSelectFinding={(findingId) => go.localFinding(ref, findingId)}
    />
  );
}

const localSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local/$label/reviews/$reviewRepo/$number/runs/$runId",
  validateSearch: validateLocalSearch,
  component: LocalSessionPage,
});

function LocalSessionPage() {
  const params = localSessionRoute.useParams();
  const ref = localReviewRef(params, localSessionRoute.useSearch());
  const go = useGo();
  return (
    <RunSession
      repo={ref.repo}
      number={ref.number}
      runId={params.runId}
      onSelectRun={(runId) => go.localSession(ref, runId, { replace: true })}
      onBack={() => go.localReview(ref)}
      backLabel="Back to review"
    />
  );
}

// ── Compare ───────────────────────────────────────────────────────────────────

const compareIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare",
  // A bare /compare goes back to the last repo compared, with its head.
  beforeLoad: () => {
    const repo = rememberedCompareRepo();
    if (!repo) return;
    const [owner, name] = repo.split("/");
    throw redirect({ to: "/compare/$owner/$repo", params: { owner, repo: name }, search: { head: loadCompareHead(repo) }, replace: true });
  },
  component: CompareIndexPage,
});

function CompareIndexPage() {
  const { data: repos } = useQuery<string[]>("/api/repos");
  const go = useGo();
  const first = repos?.[0];
  useEffect(() => {
    if (first) go.compare(first, {}, { replace: true });
  }, [first, go]);
  if (repos && !first) return <NotFound title="No repository configured" detail="Set REPOS in .env." backLabel="Back to pull requests" onBack={go.prList} />;
  return null;
}

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare/$owner/$repo",
  validateSearch: validateCompareSearch,
  component: ComparePage,
});

function ComparePage() {
  const params = compareRoute.useParams();
  const search = compareRoute.useSearch();
  const go = useGo();
  const repo = `${params.owner}/${params.repo}`;
  return (
    <CompareView
      key={repo}
      repo={repo}
      search={search}
      onRepoChange={(r) => go.compare(r, { head: loadCompareHead(r) }, { replace: true })}
      onSearchChange={(next) => go.compare(repo, next, { replace: true })}
      onRemember={saveCompare}
      onSelectReview={go.compareReview}
      onBackToList={go.compareList}
    />
  );
}

function compareReviewRef(params: { owner: string; repo: string; reviewRepo: string; number: string }, search: CompareSearch): CompareReviewRef {
  return {
    repo: compareRepoFromSegment(params.reviewRepo),
    number: Number(params.number),
    ghRepo: `${params.owner}/${params.repo}`,
    base: search.base ?? "",
    head: search.head ?? "",
  };
}

const compareReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare/$owner/$repo/reviews/$reviewRepo/$number",
  validateSearch: validateCompareSearch,
  component: CompareReviewPage,
});

function CompareReviewPage() {
  const ref = compareReviewRef(compareReviewRoute.useParams(), compareReviewRoute.useSearch());
  const go = useGo();
  return (
    <LocalReviewDetail
      key={`${ref.repo}#${ref.number}`}
      repo={ref.repo}
      number={ref.number}
      repoLabel={ref.ghRepo}
      branch={ref.head}
      base={ref.base}
      backLabel="Back to compare"
      onBack={() => go.compare(ref.ghRepo, { head: ref.head, base: ref.base })}
      onSelectFinding={(findingId) => go.compareFinding(ref, findingId)}
      onOpenSession={(runId) => go.compareSession(ref, runId)}
    />
  );
}

const compareFindingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare/$owner/$repo/reviews/$reviewRepo/$number/findings/$findingId",
  validateSearch: validateCompareSearch,
  component: CompareFindingPage,
});

function CompareFindingPage() {
  const params = compareFindingRoute.useParams();
  const ref = compareReviewRef(params, compareFindingRoute.useSearch());
  const go = useGo();
  return (
    <FindingDetail
      key={params.findingId}
      findingId={params.findingId}
      repo={ref.repo}
      number={ref.number}
      readOnly
      onBack={() => go.compareReview(ref)}
      onSelectFinding={(findingId) => go.compareFinding(ref, findingId)}
    />
  );
}

const compareSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare/$owner/$repo/reviews/$reviewRepo/$number/runs/$runId",
  validateSearch: validateCompareSearch,
  component: CompareSessionPage,
});

function CompareSessionPage() {
  const params = compareSessionRoute.useParams();
  const ref = compareReviewRef(params, compareSessionRoute.useSearch());
  const go = useGo();
  return (
    <RunSession
      repo={ref.repo}
      number={ref.number}
      runId={params.runId}
      onSelectRun={(runId) => go.compareSession(ref, runId, { replace: true })}
      onBack={() => go.compareReview(ref)}
      backLabel="Back to review"
    />
  );
}

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  validateSearch: (raw: Record<string, unknown>): ActivitySearch => {
    const days = Number(raw.days);
    return {
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      kind: typeof raw.kind === "string" && raw.kind ? raw.kind : undefined,
      q: typeof raw.q === "string" && raw.q ? raw.q : undefined,
    };
  },
  component: ActivityPage,
});

function ActivityPage() {
  const search = activityRoute.useSearch();
  const go = useGo();
  return <ActivityView search={search} onSearchChange={(next) => go.activity(next, { replace: true })} />;
}

function UnknownPath() {
  const go = useGo();
  return <NotFound title="Page not found" detail={window.location.pathname} backLabel="Back to pull requests" onBack={go.prList} />;
}

const routeTree = rootRoute.addChildren([
  indexRoute,
  prListRoute,
  prRoute,
  findingRoute,
  sessionRoute,
  localIndexRoute,
  localListRoute,
  localReviewRoute,
  localFindingRoute,
  localSessionRoute,
  compareIndexRoute,
  compareRoute,
  compareReviewRoute,
  compareFindingRoute,
  compareSessionRoute,
  activityRoute,
]);

export const router = createRouter({
  routeTree,
  // Plain `?author=a&author=b` instead of the default JSON-encoded values.
  parseSearch,
  stringifySearch,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
