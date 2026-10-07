import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };

export interface LocalRepo {
  label: string;
  path: string;
}

// Docker mounts REPOS_ROOT at /repos and says so; in dev mode the checkouts are read in place.
const localReposRoot = () => process.env.LOCAL_REPOS_ROOT || process.env.REPOS_ROOT || "/repos";

export function configuredLocalRepos(): LocalRepo[] {
  const root = localReposRoot().replace(/\/+$/, "");
  return (process.env.LOCAL_REPOS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [label, relPath] = entry.includes("=") ? entry.split("=") : [entry, entry];
      return { label, path: `${root}/${relPath}` };
    });
}

// Optional locks off: the checkouts are mounted read-only, so git must not try to refresh the index.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { ...EXEC_OPTS, env: GIT_ENV });
  return stdout;
}

/** `git diff --no-index` exits 1 when the files differ, which is the case we want. */
async function gitAllowingDiffExit(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { ...EXEC_OPTS, env: GIT_ENV });
    return stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1 && typeof e.stdout === "string") return e.stdout;
    throw err;
  }
}

export interface LocalBranch {
  name: string;
  current: boolean;
}

export async function listLocalBranches(repoPath: string): Promise<LocalBranch[]> {
  const stdout = await git(repoPath, ["for-each-ref", "--format=%(refname:short)|%(HEAD)", "refs/heads/"]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split("|");
      return { name, current: head === "*" };
    });
}

export async function defaultBaseBranch(repoPath: string): Promise<string> {
  const branches = await listLocalBranches(repoPath);
  const names = new Set(branches.map((b) => b.name));
  for (const candidate of ["staging", "main", "master"]) {
    if (names.has(candidate)) return candidate;
  }
  return branches.find((b) => !b.current)?.name ?? branches[0]?.name ?? "main";
}

export interface LocalDiffFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface LocalDiffResult {
  diff: string;
  files: LocalDiffFile[];
  /** What the branch is compared with: origin/<base> when it exists, so a stale local base does not matter. */
  baseRef: string;
  /** Commits on the branch that the base does not have. */
  ownCommits: number;
  /** The worktree whose uncommitted work is included, when the branch is checked out somewhere readable. */
  worktree: string | null;
  uncommittedFiles: number;
}

// Git records worktree locations as paths on the host. In Docker the same folders live under
// LOCAL_REPOS_ROOT, and HOST_REPOS_ROOT says where they are on the host.
function toReadablePath(hostPath: string): string {
  const hostRoot = process.env.HOST_REPOS_ROOT?.replace(/\/+$/, "");
  if (hostRoot && hostPath.startsWith(hostRoot + "/")) return localReposRoot().replace(/\/+$/, "") + hostPath.slice(hostRoot.length);
  return hostPath;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function resolveBaseRef(repoPath: string, base: string): Promise<string> {
  return (await refExists(repoPath, `refs/remotes/origin/${base}`)) ? `origin/${base}` : base;
}

interface Worktree {
  path: string;
  gitDir: string;
}

/** Where the branch is checked out, as paths git can use from here; null when nowhere readable. */
async function findWorktree(repoPath: string, branch: string): Promise<Worktree | null> {
  const porcelain = await git(repoPath, ["worktree", "list", "--porcelain"]);
  let current = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}` && current) {
      const path = toReadablePath(current);
      if (!fs.existsSync(path)) return null;
      const dotGit = `${path}/.git`;
      // A linked worktree's .git is a file naming its admin dir by host path; the main checkout's is the repo itself.
      if (fs.statSync(dotGit).isDirectory()) return { path, gitDir: dotGit };
      const pointer = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      const gitDir = pointer ? toReadablePath(pointer) : "";
      return gitDir && fs.existsSync(gitDir) ? { path, gitDir } : null;
    }
  }
  return null;
}

function parseNumstat(numstat: string): LocalDiffFile[] {
  return numstat
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [add, del, filePath] = line.split("\t");
      return { path: filePath, additions: Number(add) || 0, deletions: Number(del) || 0 };
    });
}

/**
 * Everything the branch changes since it left the base: its commits, and — when it is checked out
 * in a worktree this process can read — the uncommitted edits and new files there too.
 */
export async function getLocalDiff(repoPath: string, branch: string, base: string): Promise<LocalDiffResult> {
  const baseRef = await resolveBaseRef(repoPath, base);
  const mergeBase = (await git(repoPath, ["merge-base", baseRef, branch])).trim();
  const ownCommits = Number((await git(repoPath, ["rev-list", "--count", `${mergeBase}..${branch}`])).trim()) || 0;
  const worktree = await findWorktree(repoPath, branch);

  if (!worktree) {
    const range = `${mergeBase}...${branch}`;
    const [diff, numstat] = await Promise.all([git(repoPath, ["diff", range]), git(repoPath, ["diff", "--numstat", range])]);
    return { diff, files: parseNumstat(numstat), baseRef, ownCommits, worktree: null, uncommittedFiles: 0 };
  }

  const inTree = ["--git-dir", worktree.gitDir, "--work-tree", worktree.path];
  const run = (args: string[]) => git(worktree.path, [...inTree, ...args]);
  const [tracked, trackedNumstat, uncommitted, untrackedList] = await Promise.all([
    run(["diff", mergeBase]),
    run(["diff", "--numstat", mergeBase]),
    run(["diff", "--name-only", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const untracked = untrackedList.split("\n").map((l) => l.trim()).filter(Boolean);

  const untrackedDiffs = await Promise.all(
    untracked.map((file) =>
      gitAllowingDiffExit(["-C", worktree.path, "diff", "--no-index", "--", "/dev/null", file]).catch(() => "")
    )
  );
  const untrackedNumstat = await Promise.all(
    untracked.map((file) =>
      gitAllowingDiffExit(["-C", worktree.path, "diff", "--no-index", "--numstat", "--", "/dev/null", file]).catch(() => "")
    )
  );

  const newFiles = untracked.map((path, i) => {
    const counted = parseNumstat(untrackedNumstat[i])[0];
    return { path, additions: counted?.additions ?? 0, deletions: 0 };
  });
  const files = [...parseNumstat(trackedNumstat), ...newFiles];
  return {
    diff: [tracked, ...untrackedDiffs].filter(Boolean).join(""),
    files,
    baseRef,
    ownCommits,
    worktree: worktree.path,
    uncommittedFiles: uncommitted.split("\n").filter((l) => l.trim()).length + untracked.length,
  };
}

export async function getLatestCommitMessage(repoPath: string, branch: string): Promise<{ subject: string; body: string }> {
  const stdout = await git(repoPath, ["log", "-1", "--pretty=%s%x00%b", branch]);
  const [subject = "", body = ""] = stdout.split("\x00");
  return { subject: subject.trim(), body: body.trim() };
}

export function localRepoIdentity(repoLabel: string, branch: string): { repo: string; number: number } {
  const hash = crypto.createHash("sha1").update(branch).digest("hex").slice(0, 10);
  return { repo: `local/${repoLabel}-${hash}`, number: 0 };
}
