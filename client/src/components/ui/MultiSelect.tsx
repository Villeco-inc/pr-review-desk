import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { Checkbox, SHELL } from "./Field";

interface Option {
  value: string;
  label: string;
}

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  wrapperClassName = "",
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <div ref={ref} className={`relative ${wrapperClassName}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={options.length === 0}
        className={`${SHELL} w-full cursor-pointer focus-ring disabled:cursor-not-allowed disabled:bg-subtle disabled:border-fg-3 disabled:text-fg-3 disabled:shadow-none`}
      >
        <span className="shrink-0 label-caps text-fg-3">{label}</span>
        <span className="min-w-0 flex-1 truncate text-left">
          {selected.size === 0 ? "All" : `${selected.size} selected`}
        </span>
        <Icon name="chevronDown" className="size-3.5 shrink-0 text-fg-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-10 max-h-64 w-56 overflow-y-auto edge bg-surface lift">
          {options.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-fg-3">No options</div>
          ) : (
            options.map((o) => {
              const checked = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex h-9 w-full items-center gap-2 edge-soft-b px-2.5 text-left text-[length:calc(13px*var(--font-scale))] last:border-b-0 hover:bg-acid hover:text-acid-fg"
                >
                  <Checkbox checked={checked} onChange={() => toggle(o.value)} ariaLabel={o.label} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </button>
              );
            })
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="flex h-9 w-full items-center gap-1.5 edge-t px-2.5 text-left label-caps text-fg-2 hover:bg-acid hover:text-acid-fg"
            >
              <Icon name="x" className="size-3" />
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
