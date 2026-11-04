import { ALL_REPOS } from "../../../shared/types";

export interface ListState {
  /** The repository being shown; empty while none is selected. */
  repo: string;
  /** The rows on hand were loaded for that repository. */
  rowsAreCurrent: boolean;
  listLoading: boolean;
  /** The list, or the freshness it waits for, came back with an error. */
  failed: boolean;
  /** The selected repositories are not known yet, so nothing may be asked for. */
  waitingForRepos: boolean;
}

/** True from the moment a repository is shown until its rows or an error arrive, so the empty state never flashes in between. */
export function isListLoading({ repo, rowsAreCurrent, listLoading, failed, waitingForRepos }: ListState): boolean {
  return listLoading || waitingForRepos || (repo !== "" && !rowsAreCurrent && !failed);
}

/** The selected repository a name stands for, as the selection spells it, whatever the case; "all" as it is, null for any other name. */
export function matchRepo(requested: string | undefined, repos: string[]): string | null {
  if (!requested) return null;
  if (requested === ALL_REPOS) return ALL_REPOS;
  return repos.find((repo) => repo.toLowerCase() === requested.toLowerCase()) ?? null;
}

export interface ErrorSources {
  hasRepos: boolean;
  reposError: string | null;
  listError: string | null;
  freshnessError: string | null;
  hasFreshness: boolean;
}

/** The error to show above the list: the selection's first, since nothing loads without it, then the list's, then the freshness it waits for. */
export function shownError({ hasRepos, reposError, listError, freshnessError, hasFreshness }: ErrorSources): string | null {
  if (!hasRepos && reposError) return reposError;
  return listError ?? (hasFreshness ? null : freshnessError);
}
