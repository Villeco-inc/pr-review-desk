const NOT_AUTHENTICATED = /gh auth login|GH_TOKEN|Bad credentials|HTTP 401/;

/** What the PR list says when loading fails: a way out for an auth failure, the raw error otherwise. */
export function describePrListError(error: string): string {
  return NOT_AUTHENTICATED.test(error) ? "GitHub is not authenticated: run ./start.sh again. It reconnects gh when needed." : error;
}
