import { execFile } from "node:child_process";
import { DISCUSSION_QUERY, parseDiscussion, type PrDiscussion } from "./discussion";
import { promisify } from "node:util";
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

export async function fetchPullRequests(repo: string): Promise<PullRequest[]> {
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

  return (JSON.parse(stdout) as GhPrListItem[]).map((item) => toPullRequest(repo, item));
}

/** A file's text at `ref`, or null when it does not exist there. */
export async function fetchRepoFile(repo: string, path: string, ref: string): Promise<string | null> {
  const url = `repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  try {
    return await runGh(["api", url, "-H", "Accept: application/vnd.github.raw"]);
  } catch (err) {
    if (/\b404\b|Not Found/.test((err as Error).message)) return null;
    throw err;
  }
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

/** Reviews, conversation and inline threads with their replies, in one GraphQL call (first 100 of each). */
export async function fetchPrDiscussion(repo: string, number: number): Promise<PrDiscussion> {
  const [owner, name] = repo.split("/");
  const raw = await runGh(["api", "graphql", "-f", `query=${DISCUSSION_QUERY.replace(/\s+/g, " ")}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`]);
  return parseDiscussion(JSON.parse(raw));
}

export async function getHeadSha(repo: string, number: number): Promise<string> {
  const stdout = await runGh(["pr", "view", String(number), "-R", repo, "--json", "headRefOid"]);
  const parsed = JSON.parse(stdout) as { headRefOid: string };
  return parsed.headRefOid;
}

export async function fetchCheckRollup(repo: string, number: number): Promise<unknown> {
  const stdout = await runGh(["pr", "view", String(number), "-R", repo, "--json", "statusCheckRollup"]);
  return (JSON.parse(stdout) as { statusCheckRollup?: unknown }).statusCheckRollup;
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

/** Every repository the token can see — its own, collaborations and its organizations' — as owner/name, sorted. */
export async function listAccessibleRepos(): Promise<string[]> {
  const stdout = await runGh([
    "api",
    "--paginate",
    "user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
    "-q",
    ".[].full_name",
  ]);
  return stdout
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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

// ── Watching: what the notification poller reads ──

export interface ReviewRequestedPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
}

/** Open PRs asking for the viewer's review, directly or through one of their teams, across every repository. */
export async function searchReviewRequested(): Promise<ReviewRequestedPr[]> {
  const stdout = await runGh(["search", "prs", "--review-requested=@me", "--state=open", "--limit", "200", "--json", "repository,number,title,url,author"]);
  const items = JSON.parse(stdout) as { repository: { nameWithOwner: string }; number: number; title: string; url: string; author: { login: string } | null }[];
  return items.map((i) => ({ repo: i.repository.nameWithOwner, number: i.number, title: i.title, url: i.url, author: i.author?.login ?? "" }));
}

export interface OpenPrHead {
  number: number;
  title: string;
  url: string;
  headRefOid: string;
}

/** Every open PR of a repository with its head commit. Uncached: the poller needs what GitHub has now. */
export async function listOpenPrHeads(repo: string): Promise<OpenPrHead[]> {
  const stdout = await runGh(["pr", "list", "-R", repo, "--state", "open", "--limit", "200", "--json", "number,title,url,headRefOid"]);
  return JSON.parse(stdout) as OpenPrHead[];
}

export interface PrReviewComment {
  id: number;
  /** The thread's first comment: GitHub points every reply at it. */
  inReplyToId: number | null;
  author: string;
  isBot: boolean;
  body: string;
  url: string;
  createdAt: string;
}

/** Every inline review comment of a PR, replies included. */
export async function listPrReviewComments(repo: string, number: number): Promise<PrReviewComment[]> {
  const stdout = await runGh(["api", "--paginate", `repos/${repo}/pulls/${number}/comments?per_page=100`]);
  return (JSON.parse(stdout) as Record<string, unknown>[]).map((c) => {
    const user = c.user as { login?: string; type?: string } | null;
    return {
      id: Number(c.id),
      inReplyToId: typeof c.in_reply_to_id === "number" ? c.in_reply_to_id : null,
      author: user?.login ?? "",
      isBot: user?.type === "Bot",
      body: String(c.body ?? ""),
      url: String(c.html_url ?? ""),
      createdAt: String(c.created_at ?? ""),
    };
  });
}
