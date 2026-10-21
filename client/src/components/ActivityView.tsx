import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "../hooks/useApi";
import { fetchJson } from "../lib/api";
import Button from "./ui/Button";
import Card, { Band } from "./ui/Card";
import { Input, Select } from "./ui/Field";
import Icon from "./ui/Icon";
import { CardSkeleton } from "./ui/Skeleton";
import { ShellActions } from "./AppShell";

export interface ActivitySearch {
  days?: number;
  kind?: string;
  q?: string;
}

interface RunTotals {
  runs: number;
  failed: number;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  avgDurationMs: number | null;
}

interface Summary {
  days: number;
  totals: RunTotals;
  byDay: (RunTotals & { day: string })[];
  byRepo: (RunTotals & { repo: string })[];
  byModel: (RunTotals & { model: string; effort: string })[];
  events: { kind: string; count: number; errors: number; avgDurationMs: number | null }[];
}

interface EventRow {
  id: number;
  ts: string;
  kind: string;
  name: string;
  status: string | null;
  duration_ms: number | null;
  review_id: string | null;
  run_id: string | null;
  repo: string | null;
  session: string | null;
  payload: Record<string, unknown>;
}

const KINDS = ["http", "gh", "git", "claude", "review", "finding", "ui"];
const PAGE = 100;

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US");
const money = (n: number) => `$${n.toFixed(2)}`;
const duration = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)} %` : "—");
/** Times are shown in UTC and say so. */
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/** Where reviews spend time and money, and every recorded event, newest first. */
export default function ActivityView({ search, onSearchChange }: { search: ActivitySearch; onSearchChange: (next: ActivitySearch) => void }) {
  const days = search.days ?? 30;
  const kind = search.kind ?? "";
  const q = search.q ?? "";
  const { data: summary, loading, refetch } = useQuery<Summary>(`/api/telemetry/summary?days=${days}`, [days], 10_000);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [qDraft, setQDraft] = useState(q);

  const loadEvents = async (before?: number) => {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (kind) params.set("kind", kind);
      if (q) params.set("q", q);
      if (before) params.set("before", String(before));
      const rows = await fetchJson<EventRow[]>(`/api/telemetry/events?${params}`);
      setEvents((prev) => (before ? [...prev, ...rows] : rows));
      setMore(rows.length === PAGE);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, q]);

  const t = summary?.totals;

  return (
    <main className="flex flex-col gap-5 px-10 pb-10 pt-7">
      <ShellActions>
        <Button
          size="sm"
          onClick={() => {
            refetch();
            loadEvents();
          }}
        >
          <Icon name="refresh" />
          Refresh
        </Button>
      </ShellActions>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-[34px] uppercase leading-none tracking-[0.01em]">Activity</h1>
          <span className="text-xs text-fg-3">Every review run, API call and click the app recorded. Times in UTC.</span>
        </div>
        <Select
          id="activity-days"
          icon="gauge"
          label="Period"
          wrapperClassName="ml-auto w-60"
          value={String(days)}
          onChange={(e) => onSearchChange({ ...search, days: Number(e.target.value) })}
        >
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </Select>
      </div>

      {!summary && loading ? (
        <CardSkeleton lines={2} />
      ) : t ? (
        <section aria-label="Review runs" className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          <Tile label="Review runs" value={compact(t.runs)} />
          <Tile label="Cost" value={money(t.cost ?? 0)} />
          <Tile label="Tokens in" value={compact(t.tokensIn ?? 0)} />
          <Tile label="Tokens out" value={compact(t.tokensOut ?? 0)} />
          <Tile label="Failed runs" value={pct(t.failed ?? 0, t.runs)} note={`${t.failed ?? 0} of ${t.runs}`} />
          <Tile label="Average run" value={duration(t.avgDurationMs)} />
        </section>
      ) : null}

      {summary && (
        <div className="flex flex-col gap-4">
          <RunTable title="By day" rows={summary.byDay} first={{ label: "Day", get: (r) => r.day }} />
          <RunTable title="By repository" rows={summary.byRepo} first={{ label: "Repository", get: (r) => r.repo }} />
          <RunTable title="By model and effort" rows={summary.byModel} first={{ label: "Model · effort", get: (r) => `${r.model} · ${r.effort}` }} />
          <Card className="overflow-hidden">
            <Band>Events by kind</Band>
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>Kind</Th>
                  <Th right>Events</Th>
                  <Th right>Errors</Th>
                  <Th right>Average</Th>
                </tr>
              </thead>
              <tbody>
                {summary.events.map((e) => (
                  <tr key={e.kind}>
                    <Td>
                      <button type="button" className="font-mono underline hover:bg-acid hover:text-acid-fg focus-ring" onClick={() => onSearchChange({ ...search, kind: e.kind })}>
                        {e.kind}
                      </button>
                    </Td>
                    <Td right>{e.count.toLocaleString("en-US")}</Td>
                    <Td right>{e.errors.toLocaleString("en-US")}</Td>
                    <Td right>{duration(e.avgDurationMs)}</Td>
                  </tr>
                ))}
                {summary.events.length === 0 && <EmptyRow cols={4} />}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 edge-b px-5 py-3">
          <span className="font-display text-[20px] uppercase leading-none">Events</span>
          <Select id="activity-kind" label="Kind" wrapperClassName="ml-auto w-44" value={kind} onChange={(e) => onSearchChange({ ...search, kind: e.target.value || undefined })}>
            <option value="">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSearchChange({ ...search, q: qDraft || undefined });
            }}
          >
            <Input id="activity-q" icon="search" wrapperClassName="w-72" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Search name, payload, review…" />
          </form>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Kind</Th>
              <Th>Event</Th>
              <Th>Status</Th>
              <Th right>Duration</Th>
              <Th>Review / repo</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <Td mono>{utc(e.ts)}</Td>
                <Td mono>{e.kind}</Td>
                <Td>{e.name}</Td>
                <Td mono>{e.status ?? "—"}</Td>
                <Td right>{duration(e.duration_ms)}</Td>
                <Td mono>{e.review_id ?? e.repo ?? (e.session ? `tab ${e.session}` : "—")}</Td>
                <Td>
                  {Object.keys(e.payload).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer font-mono text-xs text-fg-3 hover:text-fg focus-ring">{Object.keys(e.payload).slice(0, 4).join(", ")}</summary>
                      <pre className="mt-1 max-h-64 max-w-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fg-2">{JSON.stringify(e.payload, null, 2)}</pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </Td>
              </tr>
            ))}
            {events.length === 0 && !eventsLoading && <EmptyRow cols={7} />}
          </tbody>
        </table>
        {more && (
          <div className="edge-t px-5 py-3">
            <Button size="sm" disabled={eventsLoading} onClick={() => loadEvents(events[events.length - 1]?.id)}>
              Load older events
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="flex flex-col gap-1.5 px-4 py-3.5" flat>
      <span className="text-xs text-fg-3">{label}</span>
      <span className="font-sans text-[26px] font-semibold leading-none text-fg">{value}</span>
      {note && <span className="font-mono text-[11px] text-fg-3">{note}</span>}
    </Card>
  );
}

function RunTable<R extends RunTotals>({ title, rows, first }: { title: string; rows: R[]; first: { label: string; get: (r: R) => string } }) {
  return (
    <Card className="overflow-hidden">
      <Band>{title}</Band>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <Th>{first.label}</Th>
            <Th right>Runs</Th>
            <Th right>Failed</Th>
            <Th right>Cost</Th>
            <Th right>Tokens in</Th>
            <Th right>Tokens out</Th>
            <Th right>Average</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={first.get(r)}>
              <Td mono>{first.get(r)}</Td>
              <Td right>{r.runs}</Td>
              <Td right>{r.failed}</Td>
              <Td right>{money(r.cost ?? 0)}</Td>
              <Td right>{compact(r.tokensIn ?? 0)}</Td>
              <Td right>{compact(r.tokensOut ?? 0)}</Td>
              <Td right>{duration(r.avgDurationMs)}</Td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} />}
        </tbody>
      </table>
    </Card>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`h-9 whitespace-nowrap bg-subtle px-3 label-caps text-fg-2 edge-b first:pl-5 ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`edge-soft-b px-3 py-2 first:pl-5 ${right ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""}`}>{children}</td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-5 py-4 text-fg-3">
        Nothing recorded in this period yet.
      </td>
    </tr>
  );
}
