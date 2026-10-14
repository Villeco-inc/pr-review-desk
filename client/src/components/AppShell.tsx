import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon, { type IconName } from "./ui/Icon";
import Avatar from "./ui/Avatar";
import { useQuery } from "../hooks/useApi";
import { JUMP_KEY_LABEL, isMac } from "./CommandPalette";
import { Segmented } from "./ui/Field";
import { SETTINGS_SHOW_SYSTEM_SWITCH, useSystem, type System, type Theme } from "./SystemProvider";

export type Section = "prs" | "local" | "compare" | "activity" | "repos" | "settings";
export type BuiltSection = "prs" | "local" | "compare" | "activity";

interface ShellContextValue {
  actionsEl: HTMLElement | null;
  setCount: (section: Section, count: number | undefined) => void;
}

const ShellContext = createContext<ShellContextValue>({ actionsEl: null, setCount: () => {} });

/** Renders this screen's actions into the right side of the crumb bar. */
export function ShellActions({ children }: { children: ReactNode }) {
  const { actionsEl } = useContext(ShellContext);
  return actionsEl ? createPortal(children, actionsEl) : null;
}

/** Reports a section's count to the rail. The shell stays mounted, so the last value survives leaving the screen. */
export function useRailCount(section: Section, count: number | undefined) {
  const { setCount } = useContext(ShellContext);
  useEffect(() => {
    if (count !== undefined) setCount(section, count);
  }, [section, count, setCount]);
}

export interface CrumbItem {
  label: string;
  /** Object crumbs (repo #number, branch) stay mono and keep their case. */
  mono?: boolean;
  onClick?: () => void;
}

export function Crumbs({ items }: { items: CrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const text = c.mono ? "font-mono text-[12px] font-medium normal-case" : "label-caps";
          return (
            <li key={i} className="flex min-w-0 items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="text-fg-3">/</span>}
              {last || !c.onClick ? (
                <span aria-current={last ? "page" : undefined} className={`truncate ${text} ${last ? "text-fg" : "text-fg-3"}`}>
                  {c.label}
                </span>
              ) : (
                <button type="button" onClick={c.onClick} className={`truncate ${text} text-fg-3 hover:bg-acid hover:text-acid-fg focus-ring`}>
                  {c.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface AppShellProps {
  section: Section;
  crumbs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onNavigate: (section: BuiltSection) => void;
  onJump: () => void;
}

const SECTIONS: { id: Section; label: string; icon: IconName; built: boolean }[] = [
  { id: "prs", label: "Pull requests", icon: "pullRequest", built: true },
  { id: "local", label: "Local branches", icon: "branch", built: true },
  { id: "compare", label: "Compare", icon: "compare", built: true },
  { id: "activity", label: "Activity", icon: "gauge", built: true },
  { id: "repos", label: "Repositories", icon: "repo", built: false },
  { id: "settings", label: "Settings", icon: "settings", built: false },
];

export default function AppShell({ section, crumbs, actions, children, onNavigate, onJump }: AppShellProps) {
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Section, number>>>({});
  const setCount = useCallback(
    (s: Section, n: number | undefined) => setCounts((prev) => (prev[s] === n ? prev : { ...prev, [s]: n })),
    []
  );
  const ctx = useMemo(() => ({ actionsEl, setCount }), [actionsEl, setCount]);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-screen overflow-hidden bg-page text-fg">
        <Rail section={section} counts={counts} onNavigate={onNavigate} onJump={onJump} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[54px] shrink-0 items-center gap-4 edge-b bg-page px-6">
            {crumbs}
            <div ref={setActionsEl} className="ml-auto flex shrink-0 items-center gap-2">
              {actions}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function Rail({
  section,
  counts,
  onNavigate,
  onJump,
}: {
  section: Section;
  counts: Partial<Record<Section, number>>;
  onNavigate: (section: BuiltSection) => void;
  onJump: () => void;
}) {
  const { data: viewer } = useQuery<{ login: string }>("/api/viewer", [], 5 * 60_000);
  const { data: repos } = useQuery<string[]>("/api/repos");
  const org = repos?.[0]?.split("/")[0];

  return (
    <aside className="flex h-full w-[226px] shrink-0 flex-col gap-5 edge-r bg-rail-bg px-3 py-4">
      <div className="flex items-center gap-2.5 px-1">
        <Icon name="mark" className="size-6 shrink-0 text-rail-accent" strokeWidth={2.2} />
        <span className="font-display text-[17px] uppercase leading-[18px] tracking-[0.02em] text-rail-accent">
          PR Review
          <br />
          Desk
        </span>
      </div>

      <button
        type="button"
        onClick={onJump}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        title={`Jump to… (${JUMP_KEY_LABEL})`}
        className="flex h-[38px] w-full items-center gap-2 edge border-rail-line px-2.5 text-left text-rail-fg hover:border-rail-accent hover:text-rail-accent focus-ring"
      >
        <Icon name="search" className="size-3.5 shrink-0" />
        <span className="flex-1 label-caps">Jump to…</span>
        <kbd className="edge border-rail-line px-1 font-mono text-[10px] leading-[14px]">{JUMP_KEY_LABEL}</kbd>
      </button>

      <nav aria-label="Sections">
        <ul className="flex flex-col gap-1">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            const count = counts[s.id];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  aria-disabled={s.built ? undefined : "true"}
                  title={s.built ? undefined : "Not built yet"}
                  onClick={s.built ? () => onNavigate(s.id as BuiltSection) : undefined}
                  className={`flex h-10 w-full items-center gap-2.5 edge px-2.5 text-left label-caps focus-ring ${
                    active
                      ? "border-acid bg-acid text-acid-fg"
                      : `border-transparent text-rail-fg ${s.built ? "hover:border-rail-line hover:bg-rail-hover" : "cursor-default"}`
                  }`}
                >
                  <Icon name={s.icon} className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{s.label}</span>
                  {count !== undefined && <span className="font-mono text-[11px] tracking-normal">{count}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto flex flex-col gap-3 edge-t border-rail-line pt-4">
        {SETTINGS_SHOW_SYSTEM_SWITCH && <SystemSwitch />}
        {/* Repo switching still lives in each list's filter bar; this is the placeholder for it. */}
        <button
          type="button"
          aria-disabled="true"
          title="Repository switcher (not built yet)"
          className="flex h-[38px] w-full cursor-default items-center gap-2 edge border-rail-line px-2.5 text-left text-rail-fg focus-ring"
        >
          <Icon name="repo" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{org ?? "—"}</span>
          <Icon name="chevronDown" className="size-3.5 shrink-0" />
        </button>
        {viewer?.login && (
          <div className="flex items-center gap-2 px-1 text-rail-fg">
            <Avatar name={viewer.login} />
            <span className="truncate font-mono text-[12px]">{viewer.login}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

const SYSTEMS: { value: System; label: string }[] = [
  { value: "brutal", label: "Brutal" },
  { value: "blueprint", label: "Blueprint" },
];
const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function SystemSwitch() {
  const { system, theme, setSystem, setTheme } = useSystem();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 label-caps text-rail-fg">System</span>
      <Segmented block ariaLabel="Design system" value={system} onChange={setSystem} options={SYSTEMS} />
      <span className="mt-1.5 px-1 label-caps text-rail-fg">Mode</span>
      <Segmented block ariaLabel="Colour mode" value={theme} onChange={setTheme} options={THEMES} />
    </div>
  );
}
