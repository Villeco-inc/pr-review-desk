import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type System = "linea" | "brutal" | "blueprint";
export type Theme = "light" | "dark";

export const DEFAULT_SYSTEM: System = "linea"; // the Linea design system, as in linea-web-v2
export const DEFAULT_THEME: Theme = "light";

/** Gate for the visible switch; the dual tokens cost nothing either way. */
export const SETTINGS_SHOW_SYSTEM_SWITCH = true;

const SYSTEM_KEY = "prd:system";
const THEME_KEY = "prd:theme";

interface SystemContextValue {
  system: System;
  theme: Theme;
  setSystem: (s: System) => void;
  setTheme: (t: Theme) => void;
}

const SystemContext = createContext<SystemContextValue>({
  system: DEFAULT_SYSTEM,
  theme: DEFAULT_THEME,
  setSystem: () => {},
  setTheme: () => {},
});

export function useSystem() {
  return useContext(SystemContext);
}

// The pre-paint script in index.html has already written the stored values to <html>,
// so starting from the dataset keeps the first render in step with what is on screen.
function initial<T extends string>(attr: "system" | "theme", allowed: readonly T[], fallback: T): T {
  const v = document.documentElement.dataset[attr];
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice still applies for this visit.
  }
}

export function SystemProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<System>(() => initial("system", ["linea", "brutal", "blueprint"], DEFAULT_SYSTEM));
  const [theme, setTheme] = useState<Theme>(() => initial("theme", ["light", "dark"], DEFAULT_THEME));

  useEffect(() => {
    document.documentElement.dataset.system = system;
    store(SYSTEM_KEY, system);
  }, [system]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store(THEME_KEY, theme);
  }, [theme]);

  const value = useMemo(() => ({ system, theme, setSystem, setTheme }), [system, theme]);
  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}
