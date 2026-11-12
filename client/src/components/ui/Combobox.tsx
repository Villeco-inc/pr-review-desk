import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { SHELL } from "./Field";
import { Chip } from "./Card";

interface Option {
  value: string;
  label: string;
  hint?: string;
}

export default function Combobox({
  icon,
  placeholder,
  options,
  value,
  onChange,
  wrapperClassName = "",
  disabled = false,
}: {
  icon?: IconName;
  placeholder?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  wrapperClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const select = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        select(filtered[activeIndex].value);
      } else if (filtered.length === 1) {
        select(filtered[0].value);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={ref} className={`relative ${wrapperClassName}`}>
      <label
        className={`${SHELL} w-full ${disabled ? "cursor-not-allowed" : ""}`}
      >
        {icon && <Icon name={icon} className="size-3.5 shrink-0 text-fg-3" />}
        <input
          ref={inputRef}
          type="text"
          className="min-w-0 w-full bg-transparent outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
          placeholder={placeholder}
          value={open ? query : selectedLabel}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `cb-opt-${activeIndex}` : undefined}
        />
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          className="size-3.5 shrink-0 text-fg-3"
        />
      </label>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-10 max-h-64 w-full overflow-y-auto edge bg-surface lift"
        >
          {filtered.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-fg-3">No matching branches</div>
          ) : (
            filtered.map((o, i) => {
              const isActive = i === activeIndex;
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  id={`cb-opt-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(o.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex h-9 w-full items-center gap-2 edge-soft-b px-2.5 text-left text-[length:calc(13px*var(--font-scale))] outline-none last:border-b-0 ${
                    isActive ? "bg-acid text-acid-fg" : ""
                  }`}
                >
                  {isSelected && <Icon name="check" className="size-3 shrink-0" />}
                  {!isSelected && <span className="size-3 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{o.label}</span>
                  {o.hint && <Chip className="shrink-0">{o.hint}</Chip>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
