// Decides what part of a diff the agent reads. Files a review has nothing to say about (lockfiles,
// generated output, data) are left out but named, and a file too long to send whole is cut and
// named too, so the review screen can say exactly what was not read.

import { splitUnifiedDiff } from "./diff-utils";

export const MAX_DIFF_CHARS_PER_FILE = 20_000;

export interface OmittedFile {
  path: string;
  reason: string;
  chars: number;
}

export interface TruncatedFile {
  path: string;
  chars: number;
  keptChars: number;
}

export interface DiffScope {
  /** The diff text the agent receives. */
  text: string;
  sentFiles: number;
  omitted: OmittedFile[];
  truncated: TruncatedFile[];
}

const NOISE: { reason: string; patterns: string[] }[] = [
  {
    reason: "lockfile",
    patterns: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "Gemfile.lock", "go.sum", "composer.lock", "Cargo.lock", "poetry.lock", "Podfile.lock"],
  },
  {
    reason: "generated",
    patterns: ["*.min.js", "*.min.css", "*.map", "*.snap", "**/__snapshots__/**", "dist/**", "build/**", "*.generated.*"],
  },
  { reason: "data", patterns: ["*.csv", "*.tsv", "*.parquet", "*.xlsx"] },
];

/** `*` stays within a path segment, `**` crosses them; a pattern without `/` matches the file name anywhere. */
export function globToRegExp(glob: string): RegExp {
  const anchored = glob.includes("/");
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(anchored ? `^${re}$` : `(^|/)${re}$`);
}

/** Why a file is left out, or null to send it. `extra` comes from DIFF_EXCLUDE (comma-separated globs). */
export function omitReason(path: string, extra: string[] = []): string | null {
  for (const group of NOISE) if (group.patterns.some((p) => globToRegExp(p).test(path))) return group.reason;
  if (extra.some((p) => globToRegExp(p).test(path))) return "excluded by DIFF_EXCLUDE";
  return null;
}

export const configuredExcludes = () =>
  (process.env.DIFF_EXCLUDE ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

export function scopeDiff(diff: string, extra: string[] = configuredExcludes()): DiffScope {
  const files = splitUnifiedDiff(diff);
  if (files.length === 0) return { text: diff, sentFiles: 0, omitted: [], truncated: [] };

  const omitted: OmittedFile[] = [];
  const truncated: TruncatedFile[] = [];
  const kept: string[] = [];
  for (const f of files) {
    const reason = omitReason(f.file, extra);
    if (reason) {
      omitted.push({ path: f.file, reason, chars: f.patch.length });
    } else if (f.patch.length > MAX_DIFF_CHARS_PER_FILE) {
      truncated.push({ path: f.file, chars: f.patch.length, keptChars: MAX_DIFF_CHARS_PER_FILE });
      kept.push(`${f.patch.slice(0, MAX_DIFF_CHARS_PER_FILE)}\n... [truncated: ${f.patch.length - MAX_DIFF_CHARS_PER_FILE} more characters not shown]`);
    } else {
      kept.push(f.patch);
    }
  }
  return { text: kept.join("\n"), sentFiles: kept.length, omitted, truncated };
}
