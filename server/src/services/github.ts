import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "../db/schema";
import { track } from "../db/telemetry";
import type { PullRequest } from "../../../shared/types";

const execFileAsync = promisify(execFile);

const GH_CANDIDATES = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
const EXEC_OPTS = { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };

let resolvedGhPath: string | null = null;

function ghLog(...args: unknown[]): void {
  console.log("[github]", ...args);
}

/** The command for the log, with long values (comment bodies) shortened. */
const ghArgsForLog = (args: string[]) => args.map((a) => (a.length > 200 ? `${a.slice(0, 200)}…` : a)).join(" ");

async function runGh(args: string[]): Promise<string> {
  const label = args.slice(0, 4).join(" ");
  ghLog(`exec: gh ${label}...`);
  const start = Date.now();
  const candidates = resolvedGhPath ? [resolvedGhPath] : GH_CANDIDATES;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, args, EXEC_OPTS);
      resolvedGhPath = candidate;
      ghLog(`gh ${label} done (${Date.now() - start}ms, ${stdout.length} bytes)`);
      track("gh", label, { status: "ok", durationMs: Date.now() - start, payload: { args: ghArgsForLog(args), bytes: stdout.length } });
      return stdout;
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        ghLog(`gh ${label} FAILED: ${(err as Error).message}`);
        track("gh", label, {
          status: "error",
          durationMs: Date.now() - start,
          payload: { args: ghArgsForLog(args), code: code ?? null, error: (err as Error).message.slice(0, 2000) },
        });
        throw err;
      }
      ghLog(`${candidate}: not found`);
    }
  }

  ghLog(`gh not found on any path`);
  throw lastError;
}

const PR_LIST_FIELDS =
  "number,title,author,url,updatedAt,isDraft,additions,deletions,changedFiles,headRefOid,baseRefName,headRefName,labels,reviewRequests,reviewDecision,latestReviews";

interface GhPrListItem {
  number: number;
  title: string;
  author: { login: string };
  url: string;
  updatedAt: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefOid: string;
  baseRefName: string;
  headRefName: string;
  labels: { name: string }[];
  reviewDecision?: string | null;
  latestReviews?: { author: { login: string } | null; state: string }[];
}

function toLatestReviews(reviews?: { author: { login: string } | null; state: string }[]): PullRequest["latestReviews"] {
  return (reviews ?? []).map((r) => ({ author: r.author?.login ?? "", state: r.state }));
}

function normalizeReviewDecision(value?: string | null): PullRequest["reviewDecision"] {
  return value === "APPROVED" || value === "CHANGES_REQUESTED" || value === "REVIEW_REQUIRED" ? value : null;
}

function toPullRequest(repo: string, item: GhPrListItem): PullRequest {
  return {
    repo,
    number: item.number,
    title: item.title,
    author: item.author?.login ?? "",
    url: item.url,
    updatedAt: item.updatedAt,
    isDraft: item.isDraft,
    additions: item.additions,
    deletions: item.deletions,
    changedFiles: item.changedFiles,
    headRefOid: item.headRefOid,
    baseRefName: item.baseRefName,
    headRefName: item.headRefName,
    labels: (item.labels ?? []).map((l) => l.name),
    reviewDecision: normalizeReviewDecision(item.reviewDecision),
    latestReviews: toLatestReviews(item.latestReviews),
  };
}

export async function listPullRequests(repo: string, force = false): Promise<PullRequest[]> {
  const db = getDb();

  if (!force) {
    const cached = db.prepare("SELECT prs FROM pr_cache WHERE repo = ?").get(repo) as { prs: string } | undefined;
    if (cached) return JSON.parse(cached.prs) as PullRequest[];
  }

  const stdout = await runGh([
    "pr",
    "list",
    "-R",
    repo,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    PR_LIST_FIELDS,
  ]);

  const items = JSON.parse(stdout) as GhPrListItem[];
  const prs = items.map((item) => toPullRequest(repo, item));

  db.prepare(
    `INSERT INTO pr_cache (repo, prs, fetched_at) VALUES (@repo, @prs, @fetched_at)
     ON CONFLICT(repo) DO UPDATE SET prs = excluded.prs, fetched_at = excluded.fetched_at`
  ).run({ repo, prs: JSON.stringify(prs), fetched_at: new Date().toISOString() });

  return prs;
}

const ORG_SEARCH_QUERY = `
  query($q: String!, $after: String = null) {
    search(query: $q, type: ISSUE, first: 100, after: $after) {
      nodes {
        ... on PullRequest {
          number
          title
          url
          updatedAt
          isDraft
          additions
          deletions
          changedFiles
          headRefOid
          headRefName
          baseRefName
          reviewDecision
          latestReviews(first: 50) { nodes { author { login } state } }
          author { login }
          labels(first: 20) { nodes { name } }
          repository { nameWithOwner }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface GhSearchPrNode {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  reviewDecision?: string | null;
  latestReviews: { nodes: { author: { login: string } | null; state: string }[] } | null;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] } | null;
  repository: { nameWithOwner: string };
}

export async function listOrgPullRequests(org: string, force = false): Promise<PullRequest[]> {
  const cacheKey = `org:${org}`;
  const db = getDb();

  if (!force) {
    const cached = db.prepare("SELECT prs FROM pr_cache WHERE repo = ?").get(cacheKey) as { prs: string } | undefined;
    if (cached) return JSON.parse(cached.prs) as PullRequest[];
  }

  const prs: PullRequest[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const args = ["api", "graphql", "-f", `query=${ORG_SEARCH_QUERY}`, "-f", `q=org:${org} is:pr is:open`];
    if (after) args.push("-f", `after=${after}`);
    const stdout = await runGh(args);
    const parsed = JSON.parse(stdout) as { data: { search: { nodes: GhSearchPrNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } };
    const { nodes, pageInfo } = parsed.data.search;

    for (const node of nodes) {
      prs.push({
        repo: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        author: node.author?.login ?? "",
        url: node.url,
        updatedAt: node.updatedAt,
        isDraft: node.isDraft,
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        headRefOid: node.headRefOid,
        baseRefName: node.baseRefName,
        headRefName: node.headRefName,
        labels: (node.labels?.nodes ?? []).map((l) => l.name),
        reviewDecision: normalizeReviewDecision(node.reviewDecision),
        latestReviews: toLatestReviews(node.latestReviews?.nodes),
      });
    }

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  db.prepare(
    `INSERT INTO pr_cache (repo, prs, fetched_at) VALUES (@repo, @prs, @fetched_at)
     ON CONFLICT(repo) DO UPDATE SET prs = excluded.prs, fetched_at = excluded.fetched_at`
  ).run({ repo: cacheKey, prs: JSON.stringify(prs), fetched_at: new Date().toISOString() });

  return prs;
}

export async function fetchPrDiff(repo: string, number: number): Promise<string> {
  return runGh(["pr", "diff", String(number), "-R", repo]);
}

export interface PrSnapshot {
  title: string;
  body: string;
  author: { login: string };
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  comments: unknown[];
  files: unknown[];
}

export async function fetchPrSnapshot(repo: string, number: number): Promise<PrSnapshot> {
  const stdout = await runGh([
    "pr",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,comments,files",
  ]);
  return JSON.parse(stdout) as PrSnapshot;
}

export interface ExistingReviewComment {
  author: string;
  path: string | null;
  line: number | null;
  body: string;
  url: string;
}

export interface ExistingReview {
  author: string;
  state: string;
  body: string;
  url: string;
  submittedAt: string;
}

export async function fetchExistingReviews(
  repo: string,
  number: number
): Promise<{ reviews: ExistingReview[]; comments: ExistingReviewComment[] }> {
  const [reviewsRaw, commentsRaw] = await Promise.all([
    runGh(["api", "--paginate", `repos/${repo}/pulls/${number}/reviews`]),
    runGh(["api", "--paginate", `repos/${repo}/pulls/${number}/comments`]),
  ]);

  const reviews = (JSON.parse(reviewsRaw) as Record<string, unknown>[])
    .map((r) => ({
      author: (r.user as { login?: string })?.login ?? "",
      state: String(r.state ?? ""),
      body: String(r.body ?? ""),
      url: String(r.html_url ?? ""),
      submittedAt: String(r.submitted_at ?? ""),
    }))
    .filter((r) => r.body.trim() !== "" || r.state !== "COMMENTED");

  const comments = (JSON.parse(commentsRaw) as Record<string, unknown>[]).map((c) => ({
    author: (c.user as { login?: string })?.login ?? "",
    path: typeof c.path === "string" ? c.path : null,
    line: typeof c.line === "number" ? c.line : typeof c.original_line === "number" ? c.original_line : null,
    body: String(c.body ?? ""),
    url: String(c.html_url ?? ""),
  }));

  return { reviews, comments };
}

export async function getHeadSha(repo: string, number: number): Promise<string> {
  const stdout = await runGh(["pr", "view", String(number), "-R", repo, "--json", "headRefOid"]);
  const parsed = JSON.parse(stdout) as { headRefOid: string };
  return parsed.headRefOid;
}

export async function postInlineComment(
  repo: string,
  number: number,
  body: string,
  commitId: string,
  file: string,
  line: number,
  side: "LEFT" | "RIGHT",
  startLine?: number | null
): Promise<{ url: string }> {
  const fields = [
    "-f",
    `body=${body}`,
    "-f",
    `commit_id=${commitId}`,
    "-f",
    `path=${file}`,
    "-F",
    `line=${line}`,
    "-f",
    `side=${side}`,
  ];

  if (startLine !== undefined && startLine !== null && startLine !== line) {
    fields.push("-F", `start_line=${startLine}`, "-f", `start_side=${side}`);
  }

  const stdout = await runGh(["api", `repos/${repo}/pulls/${number}/comments`, "-X", "POST", ...fields]);
  const parsed = JSON.parse(stdout) as { html_url: string };
  return { url: parsed.html_url };
}

export async function postIssueComment(repo: string, number: number, body: string): Promise<{ url: string }> {
  const stdout = await runGh([
    "api",
    `repos/${repo}/issues/${number}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${body}`,
  ]);
  const parsed = JSON.parse(stdout) as { html_url: string };
  return { url: parsed.html_url };
}

export async function postFileComment(
  repo: string,
  number: number,
  body: string,
  commitId: string,
  file: string
): Promise<{ url: string }> {
  const stdout = await runGh([
    "api",
    `repos/${repo}/pulls/${number}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${body}`,
    "-f",
    `commit_id=${commitId}`,
    "-f",
    `path=${file}`,
    "-f",
    "subject_type=file",
  ]);
  const parsed = JSON.parse(stdout) as { html_url: string };
  return { url: parsed.html_url };
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitReview(
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
  commitId: string
): Promise<{ url: string }> {
  const fields = ["-f", `event=${event}`, "-f", `commit_id=${commitId}`];
  if (body.trim()) fields.push("-f", `body=${body}`);
  const stdout = await runGh(["api", `repos/${repo}/pulls/${number}/reviews`, "-X", "POST", ...fields]);
  const parsed = JSON.parse(stdout) as { html_url: string };
  return { url: parsed.html_url };
}

let viewerLogin: Promise<string> | null = null;

/** The authenticated gh user. Memoized: it cannot change while the process runs. */
export function getViewer(): Promise<string> {
  if (!viewerLogin) {
    viewerLogin = runGh(["api", "user"]).then((stdout) => (JSON.parse(stdout) as { login: string }).login);
    viewerLogin.catch(() => {
      viewerLogin = null; // a failed lookup must not stick
    });
  }
  return viewerLogin;
}

// ── Compare: a range of commits with no pull request (e.g. main vs the tag in production) ──

export interface RepoRefs {
  defaultBranch: string;
  branches: string[];
  /** Newest first, by version when the names are versions. */
  tags: string[];
  production: ProductionRef | null;
}

export interface ProductionRef {
  tag: string;
  /** "deployment": GitHub recorded a production deployment of this tag's commit; "latest-tag": a guess. */
  source: "deployment" | "latest-tag";
  deployedAt: string | null;
}

const versionKey = (tag: string) => (tag.match(/\d+/g) ?? []).map(Number);
const byVersionDesc = (a: string, b: string) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  return b.localeCompare(a);
};

export async function fetchRepoRefs(repo: string): Promise<RepoRefs> {
  // --paginate with --jq prints one line per item across every page.
  const lines = (out: string) => out.split("\n").map((l) => l.trim()).filter(Boolean);
  const [tagLines, branchLines, repoJson, deploymentsJson] = await Promise.all([
    runGh(["api", "--paginate", `repos/${repo}/tags?per_page=100`, "--jq", '.[] | "\\(.name) \\(.commit.sha)"']),
    runGh(["api", "--paginate", `repos/${repo}/branches?per_page=100`, "--jq", ".[].name"]),
    runGh(["api", `repos/${repo}`]),
    runGh(["api", `repos/${repo}/deployments?environment=production&per_page=1`]).catch(() => "[]"),
  ]);
  const tagRows = lines(tagLines).map((l) => {
    const [name, sha] = l.split(" ");
    return { name, commit: { sha } };
  });
  const tags = tagRows.map((t) => t.name).sort(byVersionDesc);
  const branches = lines(branchLines);
  const defaultBranch = (JSON.parse(repoJson) as { default_branch?: string }).default_branch ?? "main";

  // The production deploy is dispatched with a tag, but GitHub records the commit: find the tag on it.
  const deployment = (JSON.parse(deploymentsJson) as { sha: string; created_at: string }[])[0];
  const deployedTag = deployment && tagRows.filter((t) => t.commit.sha === deployment.sha).map((t) => t.name).sort(byVersionDesc)[0];
  const production: ProductionRef | null = deployedTag
    ? { tag: deployedTag, source: "deployment", deployedAt: deployment.created_at }
    : tags[0]
      ? { tag: tags[0], source: "latest-tag", deployedAt: null }
      : null;

  return { defaultBranch, branches, tags, production };
}

export interface CompareCommit {
  sha: string;
  message: string;
  author: string;
}

// GitHub's compare endpoint stops listing at 300 files and 250 commits.
const COMPARE_FILE_LIMIT = 300;
const COMPARE_COMMIT_LIMIT = 250;

export interface CompareResult {
  /** GitHub cut the file or commit list: a review would silently miss changes. */
  truncated: boolean;
  aheadBy: number;
  behindBy: number;
  commits: CompareCommit[];
  files: { path: string; additions: number; deletions: number }[];
}

const compareRange = (base: string, head: string) => `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;

export async function fetchCompare(repo: string, base: string, head: string): Promise<CompareResult> {
  const json = JSON.parse(await runGh(["api", `repos/${repo}/compare/${compareRange(base, head)}`])) as {
    ahead_by: number;
    behind_by: number;
    commits: { sha: string; commit: { message: string; author?: { name?: string } }; author?: { login?: string } | null }[];
    files?: { filename: string; additions: number; deletions: number }[];
  };
  const fileCount = json.files?.length ?? 0;
  return {
    truncated: fileCount >= COMPARE_FILE_LIMIT || json.ahead_by > COMPARE_COMMIT_LIMIT,
    aheadBy: json.ahead_by,
    behindBy: json.behind_by,
    commits: json.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author?.name ?? "",
    })),
    files: (json.files ?? []).map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
  };
}

export async function fetchCompareDiff(repo: string, base: string, head: string): Promise<string> {
  return runGh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${compareRange(base, head)}`]);
}
