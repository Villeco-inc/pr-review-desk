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

/** The agent's verdict, on a second pass, about a finding from an earlier run. */
export type FollowupStatus = "resolved" | "still_present" | "unclear";

export interface PreviousFindingVerdict {
  id: string;
  status: FollowupStatus;
  note: string;
}

export interface Report {
  summary: string;
  findings: Finding[];
  previousFindings: PreviousFindingVerdict[];
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
  run_id: string | null;
  created_at: string | null;
  followup_status: string | null;
  followup_note: string | null;
  /** Who wrote it: NULL for the Desk's own runs, 'deadpool' for a finding read from a Deadpool verdict file. */
  source: string | null;
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
  reviewStatus: "none" | "queued" | "running" | "reported" | "failed" | "cancelled";
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
  /** Changes whenever the pull requests of any of the repositories, or the reviews on them, change: a reader holding an older one reloads the list. The same list fetched again leaves it as it is. */
  version: string;
  /** True while GitHub is being asked for one of the repositories. */
  refreshing: boolean;
  /** How often the server refreshes while someone is looking: data older than this has been missed. */
  activeEveryMs: number;
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
  /** resolved: a later run found it fixed while it was still open. */
  state: "open" | "posted" | "dismissed" | "resolved";
  /** The run that produced it; null for findings from before runs were recorded per finding. */
  runId: string | null;
  followupStatus: FollowupStatus | null;
  followupNote: string | null;
  commentUrl: string | null;
  postedAt: string | null;
  postedAs: "comment" | "pending-review";
  references: Reference[];
  postAnchor: PostAnchor;
  /** deadpool: read from a Deadpool verdict (~/.cerebro/revues), not produced by a Desk run. */
  source: FindingSource;
  /** Jev's probability that the finding holds (null = not judged); only on the latest-review read. */
  jevHolds?: number | null;
}

export type FindingSource = "desk" | "deadpool";

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
  status: "queued" | "running" | "reported" | "failed" | "cancelled";
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
  mode: string | null;
  head_sha: string | null;
  base_sha: string | null;
  instructions: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ReviewRunDto {
  id: string;
  reviewId: string;
  status: "running" | "reported" | "failed" | "cancelled";
  model: string | null;
  effort: string | null;
  maxTurns: number | null;
  /** claude --effort level; null on runs from before effort replaced the turn cap. */
  effortLevel: string | null;
  /** full: read the whole change; followup: only the commits after baseSha, judging earlier findings. */
  mode: "full" | "followup";
  headSha: string | null;
  baseSha: string | null;
  instructions: string | null;
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

/** What a Desk notification is about: a review's outcome, a GitHub event the poller saw, or an automatic review. */
export type DeskNotificationKind =
  | "review-reported"
  | "review-failed"
  | "review-requested"
  | "new-commits"
  | "comment-reply"
  | "auto-review-started"
  | "auto-review-skipped";

/** One entry of the notification history, also pushed live to every open tab. */
export interface DeskNotification {
  id: number;
  kind: DeskNotificationKind;
  title: string;
  body: string;
  /** Same tag in every tab: the system keeps one notification instead of stacking copies. */
  tag: string;
  /** Where on GitHub it happened, when it happened there (a reply opens on GitHub). */
  url: string | null;
  /** The Desk screen a click opens. */
  target: ReviewTarget | null;
  createdAt: string;
  readAt: string | null;
}

/** The single notification stream: a new notification, or the unread count after someone opened the list. */
export type NotificationStreamEvent =
  | { type: "notification"; notification: DeskNotification; unread: number }
  | { type: "read"; unread: number };

export interface NotificationListDto {
  items: DeskNotification[];
  unread: number;
}

/** Polling and automatic review, kept in the settings table. */
export interface WatchSettings {
  /** Seconds between two GitHub polls. */
  pollSeconds: number;
  /** Repositories where a review request or a push on a reviewed PR starts a review by itself. Empty by default. */
  autoReviewRepos: string[];
  /** General switch: while true no automatic review starts, and autoReviewRepos is kept as is. */
  autoReviewPaused: boolean;
  /** PRs (owner/name#number) never reviewed automatically, whatever is pushed, until removed from the list. */
  autoReviewMutedPrs: string[];
  /** No automatic review once today's runs (UTC) cost this much, in USD. */
  dailyCapUsd: number;
  autoReviewModel: string | null;
  autoReviewEffort: string | null;
}

/** What the reviewer did with a set of findings. `resolved` = fixed by a later commit. */
export interface FindingOutcomeCounts {
  total: number;
  open: number;
  posted: number;
  dismissed: number;
  resolved: number;
}

/** Jev's verdict on a set of findings, against what the reviewer did with them. */
export interface JevVerdictRow extends FindingOutcomeCounts {
  verdict: "nit" | "not-nit" | "nit-uncertain" | "fails" | "holds" | "holds-uncertain" | "unjudged";
}

export interface FindingQualitySummaryDto {
  totals: FindingOutcomeCounts;
  bySeverity: (FindingOutcomeCounts & { severity: string })[];
  byModel: (FindingOutcomeCounts & { model: string; effort: string })[];
  byRepo: (FindingOutcomeCounts & { repo: string })[];
  jev: {
    enabled: boolean;
    judged: number;
    /** A Noul at or above `yes` reads as yes, at or below `no` as no; between, uncertain. */
    thresholds: { yes: number; no: number };
    verdicts: JevVerdictRow[];
    /** Jev's mean probabilities for each reviewer decision, to tune the thresholds on. */
    byDecision: { state: string; judged: number; meanNit: number; meanHolds: number; meanSeverity: number }[];
  };
}

export interface WatchSettingsDto extends WatchSettings {
  /** What today's finished review runs (UTC) cost, against dailyCapUsd. */
  spentTodayUsd: number;
}
