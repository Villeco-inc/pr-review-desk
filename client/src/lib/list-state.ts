export interface ListState {
  /** The repository being shown; empty while none is selected. */
  repo: string;
  /** The rows on hand were loaded for that repository. */
  rowsAreCurrent: boolean;
  listLoading: boolean;
  /** The list, or the freshness it waits for, came back with an error. */
  failed: boolean;
}

/** True from the moment a repository is shown until its rows or an error arrive, so the empty state never flashes in between. */
export function isListLoading({ repo, rowsAreCurrent, listLoading, failed }: ListState): boolean {
  return listLoading || (repo !== "" && !rowsAreCurrent && !failed);
}
