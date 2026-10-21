// What a screen remembers between visits lives on the server, so it survives a cleared browser and a
// data reset resets it too. It is loaded once before the app is shown; after that every read is
// synchronous, as the router needs, and writes go out a moment later.

import { fetchJson } from "./api";

type Fields = Record<string, unknown>;

interface Memory {
  prs: { repo?: string; filters: Record<string, Fields> };
  local: { label?: string; selection: Record<string, Fields> };
  compare: { repo?: string; heads: Record<string, string> };
}

interface Stored {
  prs?: { repo?: string | null; filters?: Record<string, Fields> };
  local?: { label?: string | null; selection?: Record<string, Fields> };
  compare?: { repo?: string | null; heads?: Record<string, string> };
}

const LOAD_TIMEOUT_MS = 3000;

const blank = (): Memory => ({ prs: { filters: {} }, local: { selection: {} }, compare: { heads: {} } });

let memory: Memory = blank();

export function resetViewMemory(): void {
  memory = blank();
  pending.clear();
  clearTimeout(writeTimer);
  sending = Promise.resolve();
}

/** Loads the memory; a server that cannot be reached, or does not answer in time, leaves it empty rather than blocking the app. */
export async function loadViewMemory(timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    giveUp = setTimeout(() => resolve(null), timeoutMs);
  });
  const answer = fetchJson<Stored>("/api/view-memory").catch(() => null);
  const stored = await Promise.race([answer, timedOut]);
  clearTimeout(giveUp);
  if (!stored) return;
  memory = {
    prs: { repo: stored.prs?.repo ?? undefined, filters: stored.prs?.filters ?? {} },
    local: { label: stored.local?.label ?? undefined, selection: stored.local?.selection ?? {} },
    compare: { repo: stored.compare?.repo ?? undefined, heads: stored.compare?.heads ?? {} },
  };
}

const own = (fields: Record<string, Fields>, key: string): Fields | undefined => (Object.hasOwn(fields, key) ? fields[key] : undefined);

// Writes wait for the changes to stop, then go out one after the other in the order of the visits, so
// the server ends on the last repository looked at; a batch never starts before the previous one is
// done. A write that fails costs nothing but the memory.
const WRITE_DELAY_MS = 500;
const pending = new Map<string, () => Promise<unknown>>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let sending: Promise<void> = Promise.resolve();

function queue(key: string, send: () => Promise<unknown>): void {
  pending.delete(key);
  pending.set(key, send);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void flush(), WRITE_DELAY_MS);
}

function take(): Array<() => Promise<unknown>> {
  const batch = [...pending.values()];
  pending.clear();
  return batch;
}

function flush(): Promise<void> {
  clearTimeout(writeTimer);
  sending = sending.then(async () => {
    for (const send of take()) await send().catch(() => {});
  });
  return sending;
}

// A page that is going away cannot wait for an answer: everything goes out at once, in order.
function flushNow(): void {
  clearTimeout(writeTimer);
  for (const send of take()) void send().catch(() => {});
}

const write = (url: string, method: "PUT" | "DELETE", body?: unknown) => () =>
  fetchJson(url, { method, body: body === undefined ? undefined : JSON.stringify(body), keepalive: true });

export const prsMemory = {
  repo: (): string | undefined => memory.prs.repo,
  filters: (repo: string): Fields | undefined => own(memory.prs.filters, repo),
  remember(repo: string, filters: object): void {
    if (repo === "__proto__") return;
    // Always sent, even when this tab's copy already holds it: that copy may be older than the server's, and
    // the last tab to act must win. The server does not write what it already holds.
    const fields = filters as Fields;
    memory.prs.repo = repo;
    memory.prs.filters[repo] = fields;
    queue(`prs:${repo}`, write("/api/view-memory/prs", "PUT", { repo, filters: fields }));
  },
};

export const compareMemory = {
  repo: (): string | undefined => memory.compare.repo,
  head: (repo: string): string | undefined => (Object.hasOwn(memory.compare.heads, repo) ? memory.compare.heads[repo] : undefined),
  remember(repo: string, head?: string): void {
    if (repo === "__proto__") return;
    memory.compare.repo = repo;
    if (head) memory.compare.heads[repo] = head;
    queue(`compare:${repo}`, write("/api/view-memory/compare", "PUT", { repo, head }));
  },
};

export const localMemory = {
  label: (): string | undefined => memory.local.label,
  selection: (label: string): Fields | undefined => own(memory.local.selection, label),
  remember(label: string, selection: object): void {
    if (label === "__proto__") return;
    const fields = selection as Fields;
    memory.local.label = label;
    memory.local.selection[label] = fields;
    queue(`local:${label}`, write("/api/view-memory/local", "PUT", { label, selection: fields }));
  },
  forget(label: string): void {
    if (label === "__proto__") return;
    delete memory.local.selection[label];
    if (memory.local.label === label) memory.local.label = undefined;
    queue(`local:${label}`, write(`/api/view-memory/local/${encodeURIComponent(label)}`, "DELETE"));
  },
};

// The page may be gone before the wait is over: what is pending goes out now, and keepalive lets it finish.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("pagehide", flushNow);
