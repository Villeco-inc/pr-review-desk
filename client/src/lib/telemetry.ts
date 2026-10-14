// Interface telemetry: screens, clicks and errors are queued here and sent to the server in batches,
// every few seconds and once more when the tab is hidden or closed.

const ENDPOINT = "/api/telemetry/events";
const FLUSH_MS = 5000;

interface UiEvent {
  name: string;
  ts: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
}

let queue: UiEvent[] = [];
let started = false;

function sessionId(): string {
  try {
    let id = sessionStorage.getItem("prd:telemetry-session");
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem("prd:telemetry-session", id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

export function trackUi(name: string, payload: Record<string, unknown> = {}, durationMs?: number) {
  queue.push({ name, ts: new Date().toISOString(), durationMs, payload });
}

function flush(useBeacon = false) {
  if (queue.length === 0) return;
  const body = JSON.stringify({ session: sessionId(), events: queue });
  queue = [];
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {
    // Telemetry is best effort: a lost batch is not worth an error on screen.
  });
}

/** What a click was on, in words: its label, never the content of a field. */
function describeTarget(el: Element): Record<string, unknown> {
  const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    label: label.slice(0, 80),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    href: el instanceof HTMLAnchorElement ? el.href : null,
    path: location.pathname,
  };
}

let currentScreen: { path: string; search: string; since: number } | null = null;

/** Called on every route change: closes the previous screen with its time on screen, opens the next. */
export function trackScreen(path: string, search: string, routeId: string) {
  const now = Date.now();
  if (currentScreen && currentScreen.path === path && currentScreen.search === search) return;
  if (currentScreen) trackUi("screen.leave", { path: currentScreen.path, search: currentScreen.search }, now - currentScreen.since);
  trackUi("screen.view", { path, search, routeId, previous: currentScreen?.path ?? null });
  currentScreen = { path, search, since: now };
}

export function startTelemetry() {
  if (started) return;
  started = true;
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as Element | null)?.closest?.("button, a, summary, [role=option], [role=radio], [role=checkbox]");
      if (el) trackUi("click", describeTarget(el));
    },
    { capture: true }
  );
  window.addEventListener("error", (e) => trackUi("error", { message: e.message, source: e.filename, line: e.lineno, path: location.pathname }));
  window.addEventListener("unhandledrejection", (e) => trackUi("error", { message: String((e.reason as Error)?.message ?? e.reason), kind: "promise", path: location.pathname }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (currentScreen) trackUi("screen.hidden", { path: currentScreen.path }, Date.now() - currentScreen.since);
      flush(true);
    }
  });
  window.addEventListener("pagehide", () => flush(true));
  setInterval(() => flush(), FLUSH_MS);
}
