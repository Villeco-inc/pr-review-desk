import { useEffect, type ReactNode } from "react";
import { useMutation, useQuery } from "../hooks/useApi";
import type { ReviewRunDto, RunSessionDto } from "../../../shared/types";
import StatusBadge from "./StatusBadge";
import Button from "./ui/Button";
import Card, { Band, Chip } from "./ui/Card";
import { Select } from "./ui/Field";
import Icon from "./ui/Icon";
import { CardSkeleton } from "./ui/Skeleton";
import NotFound from "./ui/NotFound";
import { useToast } from "./ui/Toast";
import { ShellActions } from "./AppShell";
import { formatCount, relativeTime } from "../lib/format";
import { useHotkeys } from "../hooks/useHotkeys";

const POLL_MS = 2000;

/** Everything one run of the review agent saw and said, from the raw stream-json it printed. */
export default function RunSession({
  repo,
  number,
  runId,
  onSelectRun,
  onBack,
  backLabel,
}: {
  repo: string;
  number: number;
  runId: string;
  onSelectRun: (runId: string) => void;
  onBack: () => void;
  backLabel: string;
}) {
  const { data: session, error, loading, refetch } = useQuery<RunSessionDto>(`/api/runs/${runId}`, [runId]);
  const { data: runs } = useQuery<ReviewRunDto[]>(`/api/reviews/${repo}/${number}/runs`, [repo, number, session?.run.status]);
  const running = session?.run.status === "running";

  // A run in progress keeps growing on disk; follow it until it settles.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refetch, POLL_MS);
    return () => clearInterval(t);
  }, [running, refetch]);

  useHotkeys({ Escape: onBack });

  if (error && !session) return <NotFound title="Session not found" detail={error} backLabel={backLabel} onBack={onBack} />;

  const run = session?.run;

  return (
    <main className="flex flex-col gap-4 px-10 pb-10 pt-5">
      <ShellActions>
        {runs && runs.length > 1 && (
          <Select id="run" icon="terminal" label="Run" wrapperClassName="w-[300px]" value={runId} onChange={(e) => onSelectRun(e.target.value)} aria-label="Run">
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString()} · {r.model ?? "default"} · {r.status}
              </option>
            ))}
          </Select>
        )}
        <Button size="sm" onClick={refetch} disabled={loading}>
          <Icon name="refresh" className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
        <Button size="sm" onClick={onBack} aria-keyshortcuts="Escape" title={`${backLabel} (Esc)`}>
          <Icon name="arrowLeft" />
          {backLabel}
        </Button>
      </ShellActions>

      {!session || !run ? (
        <CardSkeleton lines={3} />
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-[18px]">
              <h1 className="font-display text-[26px] uppercase leading-none">Review session</h1>
              <StatusBadge status={run.status} />
              <span className="font-mono text-xs text-fg-3" title={new Date(run.startedAt).toLocaleString()}>
                started {relativeTime(run.startedAt)}
              </span>
              {run.sessionId && <Chip mono>{run.sessionId}</Chip>}
            </div>
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] edge-t">
              <Stat label="Model" value={run.model ?? "default"} />
              <Stat label="Effort" value={run.effort ? `${run.effort} · ${run.effortLevel ? `${run.effortLevel} effort` : `${run.maxTurns ?? "?"} turns max`}` : "—"} />
              <Stat label="Files sent" value={run.sentFiles != null && run.diffFiles != null ? `${run.sentFiles} of ${run.diffFiles}` : "—"} />
              <Stat label="Turns" value={run.numTurns ?? "—"} />
              <Stat label="Duration" value={run.durationMs != null ? formatDuration(run.durationMs) : running ? "running…" : "—"} />
              <Stat label="Tokens in / out" value={run.inputTokens != null ? `${formatCount(run.inputTokens)} / ${formatCount(run.outputTokens ?? 0)}` : "—"} />
              <Stat label="Cache read / write" value={run.cacheReadTokens != null ? `${formatCount(run.cacheReadTokens)} / ${formatCount(run.cacheCreationTokens ?? 0)}` : "—"} />
              <Stat label="Cost" value={run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : "—"} />
              <Stat label="Skills" value={run.skills.length ? run.skills.join(", ") : "—"} />
            </dl>
            {run.status === "failed" && run.error && (
              <div role="alert" className="flex flex-col edge-t bg-danger-soft">
                <Band tone="problem">
                  <Icon name="alert" className="size-3.5" />
                  Run failed
                </Band>
                <pre className="mx-5 my-3.5 whitespace-pre-wrap font-mono text-xs leading-[18px] text-danger-ink">{run.error}</pre>
              </div>
            )}
          </Card>

          {(run.omittedFiles.length > 0 || run.truncatedFiles.length > 0) && (
            <Collapsible title="Not read in full" meta={`${run.omittedFiles.length} omitted · ${run.truncatedFiles.length} cut`} open>
              <ul className="flex flex-col gap-1 px-5 py-3.5 font-mono text-xs text-fg-2">
                {run.omittedFiles.map((f) => (
                  <li key={f.path}>
                    <span className="text-fg">{f.path}</span> — omitted ({f.reason}, {formatCount(f.chars)} chars)
                  </li>
                ))}
                {run.truncatedFiles.map((f) => (
                  <li key={f.path}>
                    <span className="text-fg">{f.path}</span> — cut: first {formatCount(f.keptChars)} of {formatCount(f.chars)} chars sent
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}

          <Collapsible title="Prompt" meta={`${formatCount(run.promptChars)} chars`}>
            <Pre>{session.prompt || "(the prompt was not recorded)"}</Pre>
          </Collapsible>

          {session.stderr && (
            <Collapsible title="stderr" meta={`${formatCount(session.stderr.length)} chars`} open={run.status === "failed"}>
              <Pre>{session.stderr}</Pre>
            </Collapsible>
          )}

          <section aria-label="Events" className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-[22px] uppercase leading-none">Events</h2>
              <span className="font-mono text-xs text-fg-3">
                {session.events.length}
                {running ? " · following the run" : ""}
              </span>
            </div>
            {session.events.length === 0 && (
              <Card className="flex items-center gap-3 p-5 text-fg-2">
                <Icon name="inbox" className="size-4 text-fg-3" />
                {running ? "Waiting for the agent's first event…" : "The agent printed nothing."}
              </Card>
            )}
            {session.events.map((e, i) => (
              <EventView key={i} index={i + 1} event={e} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 edge-soft-r px-5 py-3 last:border-r-0">
      <dt className="label-caps text-fg-3">{label}</dt>
      <dd className="truncate font-mono text-[13px] text-fg">{value}</dd>
    </div>
  );
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Pre({ children }: { children: ReactNode }) {
  return <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words px-5 py-3.5 font-mono text-xs leading-[19px] text-fg-2">{children}</pre>;
}

/** `nested` sits inside an event card, so it only draws the rule above it. */
function Collapsible({ title, meta, open, nested, children }: { title: string; meta?: string; open?: boolean; nested?: boolean; children: ReactNode }) {
  return (
    <details open={open} className={`group ${nested ? "edge-t" : "edge bg-surface lift"}`}>
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 hover:bg-row-hover focus-ring [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" className="size-3.5 shrink-0 group-open:rotate-90" />
        <span className="label-caps text-fg">{title}</span>
        {meta && <span className="font-mono text-xs text-fg-3">{meta}</span>}
      </summary>
      <div className="edge-t">{children}</div>
    </details>
  );
}

type Block = { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean };

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** A tool result's content is a string or a list of text blocks. */
const resultText = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : json(c))).join("\n")
      : json(content);

function EventView({ index, event }: { index: number; event: unknown }) {
  if (!event || typeof event !== "object") {
    return (
      <Collapsible title={`#${index} · raw line`}>
        <Pre>{String(event)}</Pre>
      </Collapsible>
    );
  }
  const e = event as Record<string, unknown>;
  const raw = (
    <Collapsible nested title="Raw event">
      <Pre>{json(e)}</Pre>
    </Collapsible>
  );

  if (e.type === "system") {
    const tools = Array.isArray(e.tools) ? e.tools.length : undefined;
    return (
      <EventCard index={index} kind={`system${e.subtype ? ` · ${e.subtype}` : ""}`}>
        <div className="flex flex-wrap gap-2 px-5 py-3 font-mono text-xs text-fg-2">
          {typeof e.model === "string" && <Chip mono>model {e.model}</Chip>}
          {tools !== undefined && <Chip mono>{tools} tools</Chip>}
          {typeof e.permissionMode === "string" && <Chip mono>{e.permissionMode}</Chip>}
          {typeof e.cwd === "string" && <Chip mono>{e.cwd}</Chip>}
        </div>
        {raw}
      </EventCard>
    );
  }

  if (e.type === "assistant" || e.type === "user") {
    const content = ((e.message as { content?: unknown } | undefined)?.content ?? []) as Block[] | string;
    const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
    return (
      <EventCard index={index} kind={e.type}>
        <div className="flex flex-col">
          {blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      </EventCard>
    );
  }

  if (e.type === "result") {
    return (
      <EventCard index={index} kind={`result${e.subtype ? ` · ${e.subtype}` : ""}`} tone={e.is_error ? "problem" : "summary"}>
        {typeof e.result === "string" && (
          <Collapsible nested title="Final text" meta={`${formatCount(e.result.length)} chars`}>
            <Pre>{e.result}</Pre>
          </Collapsible>
        )}
        {raw}
      </EventCard>
    );
  }

  return (
    <EventCard index={index} kind={String(e.type ?? "event")}>
      {raw}
    </EventCard>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "text") return <p className="whitespace-pre-wrap break-words px-5 py-3.5 text-fg">{block.text}</p>;
  if (block.type === "thinking")
    return (
      <Collapsible nested title="Thinking" meta={`${formatCount((block.thinking ?? "").length)} chars`}>
        <Pre>{block.thinking}</Pre>
      </Collapsible>
    );
  if (block.type === "tool_use")
    return (
      <Collapsible nested title={`Tool call · ${block.name ?? "?"}`}>
        <Pre>{json(block.input)}</Pre>
      </Collapsible>
    );
  if (block.type === "tool_result")
    return (
      <Collapsible nested title={`Tool result${block.is_error ? " · error" : ""}`}>
        <Pre>{resultText(block.content)}</Pre>
      </Collapsible>
    );
  return (
    <Collapsible nested title={block.type ?? "block"}>
      <Pre>{json(block)}</Pre>
    </Collapsible>
  );
}

function EventCard({ index, kind, tone = "neutral", children }: { index: number; kind: string; tone?: "neutral" | "summary" | "problem"; children: ReactNode }) {
  return (
    <Card className="overflow-hidden" flat>
      <Band tone={tone}>
        <span className="font-mono">#{index}</span>
        {kind}
      </Band>
      {children}
    </Card>
  );
}

/** Opens the latest run's session; shown only once the review has a recorded run. */
export function SessionButton({ repo, number, status, onOpen }: { repo: string; number: number; status?: string; onOpen: (runId: string) => void }) {
  const { data: runs } = useQuery<ReviewRunDto[]>(`/api/reviews/${repo}/${number}/runs`, [repo, number, status]);
  const latest = runs?.[0];
  if (!latest) return null;
  return (
    <Button variant="quiet" onClick={() => onOpen(latest.id)} title="Everything the agent saw and said during the latest run">
      <Icon name="cpu" />
      Session
      {runs.length > 1 && <Chip mono>{runs.length}</Chip>}
    </Button>
  );
}

/**
 * A review that failed on an unreadable report can be read again from the saved answer of its
 * latest run, with the current parser — no new Claude call, no cost.
 */
export function ReimportButton({ repo, number, error, onDone }: { repo: string; number: number; error: string | null; onDone: () => void }) {
  const { data: runs } = useQuery<ReviewRunDto[]>(`/api/reviews/${repo}/${number}/runs`, [repo, number, error]);
  const reimport = useMutation<{ findings: number }>("__reimport__", "POST");
  const { toast } = useToast();
  const latest = runs?.[0];
  if (!latest || !error || !/invalid JSON|no JSON report/.test(error)) return null;
  return (
    <Button
      size="sm"
      variant="acid"
      disabled={reimport.loading}
      title="Reads the agent's saved answer again with the current parser. No new run, no cost."
      onClick={async () => {
        try {
          const res = await reimport.mutate({}, `/api/runs/${latest.id}/reimport`);
          toast({ kind: "success", message: `Report read again: ${res.findings} finding${res.findings === 1 ? "" : "s"}` });
          onDone();
        } catch (err) {
          toast({ kind: "error", message: `Still unreadable: ${(err as Error).message}` });
        }
      }}
    >
      <Icon name="refresh" />
      Read the report again
    </Button>
  );
}

/** Says when the latest run did not read every file of the change in full. */
export function ScopeNote({ repo, number, status, onOpen }: { repo: string; number: number; status?: string; onOpen: (runId: string) => void }) {
  const { data: runs } = useQuery<ReviewRunDto[]>(`/api/reviews/${repo}/${number}/runs`, [repo, number, status]);
  const latest = runs?.[0];
  if (!latest || (latest.omittedFiles.length === 0 && latest.truncatedFiles.length === 0)) return null;
  const parts = [
    latest.omittedFiles.length > 0 && `${latest.omittedFiles.length} file${latest.omittedFiles.length > 1 ? "s" : ""} left out (${[...new Set(latest.omittedFiles.map((f) => f.reason))].join(", ")})`,
    latest.truncatedFiles.length > 0 && `${latest.truncatedFiles.length} file${latest.truncatedFiles.length > 1 ? "s" : ""} cut to ${formatCount(latest.truncatedFiles[0].keptChars)} chars`,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 edge-t bg-acid-soft px-5 py-2.5 text-xs text-fg">
      <Icon name="alert" className="size-3.5 text-fg-3" />
      <span>Not read in full: {parts.join(" · ")}.</span>
      <button type="button" className="font-bold underline hover:bg-acid hover:text-acid-fg focus-ring" onClick={() => onOpen(latest.id)}>
        See which
      </button>
    </div>
  );
}
