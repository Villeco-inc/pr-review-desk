import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { compareRepoSegment, reviewRepoSegment, type CompareSearch, type LocalSearch } from "./lib/url-state";
import type { ActivitySearch } from "./components/ActivityView";

const splitRepo = (repo: string) => {
  const i = repo.indexOf("/");
  return { owner: repo.slice(0, i), repo: repo.slice(i + 1) };
};

/** A compare review: `repo` is the review's own id (`compare/<name>-<hash>`), `ghRepo` the GitHub repo. */
export interface CompareReviewRef {
  repo: string;
  number: number;
  ghRepo: string;
  base: string;
  head: string;
}

export interface LocalReviewRef {
  repo: string;
  number: number;
  repoLabel: string;
  branch: string;
  base: string;
}

/** One function per screen, so callers never spell a path by hand. */
export function useGo() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      // Lists open without a query: their route restores what was remembered.
      prList: () => navigate({ to: "/prs" }),
      pr: (repo: string, number: number) =>
        navigate({ to: "/prs/$owner/$repo/$number", params: { ...splitRepo(repo), number: String(number) } }),
      finding: (repo: string, number: number, findingId: string) =>
        navigate({ to: "/prs/$owner/$repo/$number/findings/$findingId", params: { ...splitRepo(repo), number: String(number), findingId } }),
      session: (repo: string, number: number, runId: string, opts: { replace?: boolean } = {}) =>
        navigate({ to: "/prs/$owner/$repo/$number/runs/$runId", params: { ...splitRepo(repo), number: String(number), runId }, ...opts }),
      localList: () => navigate({ to: "/local" }),
      localBranch: (label: string, search: LocalSearch) => navigate({ to: "/local/$label", params: { label }, search }),
      localReview: ({ repo, number, repoLabel, branch, base }: LocalReviewRef) =>
        navigate({
          to: "/local/$label/reviews/$reviewRepo/$number",
          params: { label: repoLabel, reviewRepo: reviewRepoSegment(repo), number: String(number) },
          search: { branch, base },
        }),
      localFinding: ({ repo, number, repoLabel, branch, base }: LocalReviewRef, findingId: string) =>
        navigate({
          to: "/local/$label/reviews/$reviewRepo/$number/findings/$findingId",
          params: { label: repoLabel, reviewRepo: reviewRepoSegment(repo), number: String(number), findingId },
          search: { branch, base },
        }),
      localSession: ({ repo, number, repoLabel, branch, base }: LocalReviewRef, runId: string, opts: { replace?: boolean } = {}) =>
        navigate({
          to: "/local/$label/reviews/$reviewRepo/$number/runs/$runId",
          params: { label: repoLabel, reviewRepo: reviewRepoSegment(repo), number: String(number), runId },
          search: { branch, base },
          ...opts,
        }),
      activity: (search: ActivitySearch = {}, opts: { replace?: boolean } = {}) => navigate({ to: "/activity", search, ...opts }),
      compareList: () => navigate({ to: "/compare" }),
      compare: (ghRepo: string, search: CompareSearch, opts: { replace?: boolean } = {}) =>
        navigate({ to: "/compare/$owner/$repo", params: splitRepo(ghRepo), search, ...opts }),
      compareReview: ({ repo, number, ghRepo, base, head }: CompareReviewRef) =>
        navigate({
          to: "/compare/$owner/$repo/reviews/$reviewRepo/$number",
          params: { ...splitRepo(ghRepo), reviewRepo: compareRepoSegment(repo), number: String(number) },
          search: { base, head },
        }),
      compareFinding: ({ repo, number, ghRepo, base, head }: CompareReviewRef, findingId: string) =>
        navigate({
          to: "/compare/$owner/$repo/reviews/$reviewRepo/$number/findings/$findingId",
          params: { ...splitRepo(ghRepo), reviewRepo: compareRepoSegment(repo), number: String(number), findingId },
          search: { base, head },
        }),
      compareSession: ({ repo, number, ghRepo, base, head }: CompareReviewRef, runId: string, opts: { replace?: boolean } = {}) =>
        navigate({
          to: "/compare/$owner/$repo/reviews/$reviewRepo/$number/runs/$runId",
          params: { ...splitRepo(ghRepo), reviewRepo: compareRepoSegment(repo), number: String(number), runId },
          search: { base, head },
          ...opts,
        }),
    }),
    [navigate]
  );
}
