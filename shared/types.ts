export const SEVERITIES = ["blocker", "high", "medium", "low", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Reference {
  file: string;
  startLine: number | null;
  endLine: number | null;
  note: string;
}

export interface Finding {
  file: string;
  startLine: number | null;
  endLine: number | null;
  side: "LEFT" | "RIGHT";
  severity: Severity;
  category: string;
  title: string;
  summary: string;
  background: string;
  problem: string;
  suggestedFix: string;
  suggestedComment: string;
  references: Reference[];
}

export interface Report {
  summary: string;
  findings: Finding[];
}

export interface FindingRow {
  id: string;
  review_id: string;
  ord: number;
  file: string;
  start_line: number | null;
  end_line: number | null;
  side: string;
  severity: string;
  category: string;
  title: string;
  summary: string;
  background: string;
  problem: string;
  suggested_fix: string;
  suggested_comment: string;
  draft_comment: string | null;
  state: string;
  comment_url: string | null;
  posted_at: string | null;
  posted_as: string;
  references_json: string;
}

export interface ReviewRow {
  id: string;
  repo: string;
  number: number;
  title: string;
  status: string;
  summary: string;
  error: string | null;
  diff: string;
  snapshot: string;
  skills: string;
  created_at: string;
  updated_at: string;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefOid: string;
  baseRefName: string;
  headRefName: string;
  labels: string[];
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** Each reviewer's most recent submitted review. Optional: PR lists cached before it existed lack it. */
  latestReviews?: { author: string; state: string }[];
}

/** The viewer's own latest review on a PR — distinct from reviewDecision, which is the PR's overall state. */
export type MyReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";

export interface PullRequestDto extends PullRequest {
  reviewStatus: "none" | "queued" | "running" | "reported" | "failed";
  /** null when the viewer has not reviewed, or when the cached list predates latestReviews (refresh fills it). */
  myReview: MyReviewState | null;
  openFindings: number;
  postedFindings: number;
}

/** How current the GitHub data behind a pull request list is. */
export interface Freshness {
  /** When the oldest of the repositories in the list was fetched; null while one of them never was. */
  fetchedAt: string | null;
  /** The last refresh error among them, until a refresh of that repository succeeds. */
  error: string | null;
  /** Changes whenever any of the repositories is fetched again, so a reader holding an older one reloads the list. */
  version: string;
}

/** The `repo` value that stands for every selected repository at once. */
export const ALL_REPOS = "all";

export interface FindingDto {
  id: string;
  reviewId: string;
  file: string;
  startLine: number | null;
  endLine: number | null;
  side: "LEFT" | "RIGHT";
  severity: Severity;
  category: string;
  title: string;
  summary: string;
  background: string;
  problem: string;
  suggestedFix: string;
  suggestedComment: string;
  draftComment: string | null;
  state: "open" | "posted" | "dismissed";
  commentUrl: string | null;
  postedAt: string | null;
  postedAs: "comment" | "pending-review";
  references: Reference[];
  postAnchor: PostAnchor;
}

export interface PostAnchor {
  kind: "line" | "file" | "pull-request";
  line: number | null;
  startLine: number | null;
  adjusted: boolean;
}

export interface ReviewDto {
  id: string;
  repo: string;
  number: number;
  title: string;
  status: "queued" | "running" | "reported" | "failed";
  summary: string;
  error: string | null;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LocalReviewDto extends ReviewDto {
  openFindings: number;
  postedFindings: number;
  totalFindings: number;
  branch: string;
  base: string;
}

export interface ReviewEvent {
  type: "status" | "progress" | "findings";
  reviewId: string;
  data: unknown;
}

/** The screen a review opens on, so a notification can lead back to it. */
export type ReviewTarget =
  | { kind: "pr"; repo: string; number: number }
  | { kind: "local"; repo: string; number: number; repoLabel: string; branch: string; base: string }
  | { kind: "compare"; repo: string; number: number; ghRepo: string; base: string; head: string };

/** A review that just finished or failed, pushed to every open tab. */
export interface ReviewOutcome {
  reviewId: string;
  status: "reported" | "failed";
  title: string;
  findings?: number;
  error?: string;
  target: ReviewTarget | null;
}

/** One execution of the review agent. A review keeps every run; the latest one produced its findings. */
export interface ReviewRunRow {
  id: string;
  review_id: string;
  status: string;
  model: string | null;
  effort: string | null;
  max_turns: number | null;
  effort_level: string | null;
  diff_files: number | null;
  sent_files: number | null;
  omitted_files: string;
  truncated_files: string;
  skills: string;
  prompt_chars: number;
  session_id: string | null;
  num_turns: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ReviewRunDto {
  id: string;
  reviewId: string;
  status: "running" | "reported" | "failed";
  model: string | null;
  effort: string | null;
  maxTurns: number | null;
  /** claude --effort level; null on runs from before effort replaced the turn cap. */
  effortLevel: string | null;
  /** Files in the change, and how many of them the agent was sent; null on older runs. */
  diffFiles: number | null;
  sentFiles: number | null;
  omittedFiles: { path: string; reason: string; chars: number }[];
  truncatedFiles: { path: string; chars: number; keptChars: number }[];
  skills: string[];
  promptChars: number;
  sessionId: string | null;
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A run with everything the agent saw and said: the prompt, every stream-json event, stderr. */
export interface RunSessionDto {
  run: ReviewRunDto;
  prompt: string;
  /** The raw `claude -p --output-format stream-json` events, in order, unmodified. */
  events: unknown[];
  stderr: string;
}

/** What a local review of a branch would read. */
export interface LocalDiffSummaryDto {
  baseRef: string;
  ownCommits: number;
  uncommittedFiles: number;
  worktree: string | null;
  files: number;
}

export interface ProductionRefDto {
  tag: string;
  source: "deployment" | "latest-tag";
  deployedAt: string | null;
}

export interface RepoRefsDto {
  defaultBranch: string;
  branches: string[];
  tags: string[];
  production: ProductionRefDto | null;
}

export interface CompareSummaryDto {
  truncated: boolean;
  aheadBy: number;
  behindBy: number;
  commits: { sha: string; message: string; author: string }[];
  files: { path: string; additions: number; deletions: number }[];
}
