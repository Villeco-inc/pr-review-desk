import { posix } from "node:path";

// The review runs without tools, so Claude never loads the reviewed repository's CLAUDE.md or AGENTS.md.
// The server reads them itself, from the PR's base branch, and pastes them into the prompt.

export const MAX_GUIDANCE_CHARS = 20_000;
const NAMES = ["CLAUDE.md", "AGENTS.md"];
const AT_FILE = /(?:^|\s)@([\w./-]+\.[A-Za-z0-9]+)/gm;

/** The root's guidance files, then those of every folder holding a changed file, outermost first. */
export function guidanceCandidates(changedPaths: string[]): string[] {
  const dirs = new Set<string>([""]);
  for (const p of changedPaths) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...dirs].flatMap((d) => NAMES.map((n) => (d ? `${d}/${n}` : n)));
}

/** Files an `@path` names, resolved from the folder of the file naming them; none outside the repository. */
export function atReferences(content: string, fromPath: string): string[] {
  const dir = posix.dirname(fromPath);
  const refs: string[] = [];
  for (const m of content.matchAll(AT_FILE)) {
    const path = posix.normalize(posix.join(dir, m[1]));
    if (path === ".." || path.startsWith("../") || path.startsWith("/")) continue;
    refs.push(path);
  }
  return refs;
}

/** The guidance files that exist, then the files they point to with `@` (one level), each fetched once. */
export async function collectRepoGuidance(changedPaths: string[], fetchFile: (path: string) => Promise<string | null>): Promise<{ path: string; content: string }[]> {
  const asked = new Set<string>();
  const found: { path: string; content: string }[] = [];
  const read = async (path: string) => {
    if (asked.has(path)) return null;
    asked.add(path);
    const content = await fetchFile(path);
    if (content !== null) found.push({ path, content });
    return content;
  };
  const candidates = guidanceCandidates(changedPaths);
  const contents = await Promise.all(candidates.map(read));
  for (const [i, content] of contents.entries()) {
    if (content === null) continue;
    for (const ref of atReferences(content, candidates[i])) await read(ref);
  }
  const order = new Map(candidates.map((p, i) => [p, i]));
  return found.sort((a, b) => (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity));
}

export function assembleGuidance(files: { path: string; content: string }[], max = MAX_GUIDANCE_CHARS): { text: string; cut: boolean; totalChars: number } {
  const full = files.map((f) => `### ${f.path}\n${f.content.trim()}`).join("\n\n");
  return { text: full.slice(0, max), cut: full.length > max, totalChars: full.length };
}
