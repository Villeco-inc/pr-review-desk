import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";

type Kind = "success" | "error";

interface Toast {
  id: number;
  kind: Kind;
  message: ReactNode;
  link?: { href: string; label: string };
  leaving?: boolean;
}

interface ToastApi {
  toast: (t: Omit<Toast, "id" | "leaving">) => void;
}

const EXIT_MS = 100;

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id" | "leaving">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" ? 8000 : 5000);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex min-w-[300px] max-w-[480px] items-center gap-2.5 edge bg-fg px-3 py-2.5 text-[length:calc(13px*var(--font-scale))] text-page transition-[opacity,transform] duration-[100ms] ${
              t.kind === "success" ? "shadow-[var(--shadow-toast-ok)]" : "shadow-[var(--shadow-toast-err)]"
            } ${t.leaving ? "translate-y-2 opacity-0" : "animate-toast-enter"}`}
          >
            <Icon name={t.kind === "success" ? "checkCircle" : "alert"} className={`size-4 shrink-0 ${t.kind === "success" ? "text-inverse-accent" : "text-danger"}`} />
            <span className="min-w-0 break-words">{t.message}</span>
            {t.link && (
              <a href={t.link.href} target="_blank" rel="noreferrer" className="ml-1 shrink-0 font-bold text-inverse-accent underline hover:text-page">
                {t.link.label}
              </a>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="ml-auto inline-flex shrink-0 p-0.5 text-page hover:bg-acid hover:text-acid-fg focus-ring"
            >
              <Icon name="x" className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
