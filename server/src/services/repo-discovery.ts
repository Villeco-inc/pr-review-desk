// Finds the repos to offer by looking at a folder of checkouts (SCAN_DIR) instead of a fixed list:
// every subfolder with a .git is a local repo, and its `origin` remote names the GitHub repo.
// A repo cloned there later shows up on its own.

import fs from "node:fs";
import path from "node:path";

export interface DiscoveredRepo {
  label: string;
  path: string;
  /** owner/name on GitHub, or null when origin is missing or not on GitHub. */
  ghRepo: string | null;
}

/** owner/name from any GitHub remote form: git@github.com:o/n.git, https://github.com/o/n, ssh://git@github.com/o/n.git */
export function githubRepoFromRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The url of [remote "origin"] in a .git/config file. */
export function originFromGitConfig(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]$/.test(line);
    else if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return null;
}

export function scanRepos(dir: string): DiscoveredRepo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos: DiscoveredRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const repoPath = path.join(dir, entry.name);
    const configPath = path.join(repoPath, ".git", "config");
    // A linked worktree has a .git file, not a folder: it belongs to another checkout, skip it.
    if (!fs.existsSync(configPath)) continue;
    const origin = originFromGitConfig(fs.readFileSync(configPath, "utf8"));
    repos.push({ label: entry.name, path: repoPath, ghRepo: origin ? githubRepoFromRemote(origin) : null });
  }
  return repos.sort((a, b) => a.label.localeCompare(b.label));
}

const CACHE_MS = 30_000;
let cache: { dir: string; at: number; repos: DiscoveredRepo[] } | null = null;

/** The repos under SCAN_DIR (relative to the checkouts root), rescanned at most every 30 s. */
export function discoveredRepos(checkoutsRoot: string): DiscoveredRepo[] {
  const scanDir = process.env.SCAN_DIR?.trim();
  if (!scanDir) return [];
  const dir = path.isAbsolute(scanDir) ? scanDir : path.join(checkoutsRoot, scanDir);
  if (cache && cache.dir === dir && Date.now() - cache.at < CACHE_MS) return cache.repos;
  cache = { dir, at: Date.now(), repos: scanRepos(dir) };
  return cache.repos;
}
