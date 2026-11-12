import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

// Focus is a 3px outline outside the ink border, never a replacement for it.
export const SHELL =
  "group inline-flex h-[var(--ctl-h)] items-center gap-2 edge bg-surface px-2.5 text-[13px] text-fg lift-sm focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-primary has-disabled:bg-subtle has-disabled:border-fg-3 has-disabled:text-fg-3 has-disabled:shadow-none";

interface ShellProps {
  icon?: IconName;
  label?: string;
  className?: string;
  error?: boolean;
  children: ReactNode;
  htmlFor?: string;
}

function Shell({ icon, label, className = "", error, children, htmlFor }: ShellProps) {
  return (
    <label htmlFor={htmlFor} className={`${SHELL} ${error ? "bg-danger-soft focus-within:outline-danger" : ""} ${className}`}>
      {icon && <Icon name={icon} className="size-3.5 shrink-0 text-fg-3" />}
      {label && <span className="shrink-0 label-caps text-fg-3">{label}</span>}
      {children}
    </label>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: IconName;
  label?: string;
  wrapperClassName?: string;
}

export function Select({ icon, label, wrapperClassName, id, className = "", ...rest }: SelectProps) {
  return (
    <Shell icon={icon} label={label} className={wrapperClassName} htmlFor={id}>
      <select
        id={id}
        className={`min-w-0 w-full appearance-none bg-transparent pr-1 outline-none cursor-pointer disabled:cursor-not-allowed ${className}`}
        {...rest}
      />
      <Icon name="chevronDown" className="size-3.5 shrink-0 text-fg-3" />
    </Shell>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  label?: string;
  wrapperClassName?: string;
  error?: boolean;
}

export function Input({ icon, label, wrapperClassName, error, id, className = "", ...rest }: InputProps) {
  return (
    <Shell icon={icon} label={label} className={wrapperClassName} error={error} htmlFor={id}>
      <input id={id} className={`min-w-0 w-full bg-transparent outline-none placeholder:text-fg-3 ${className}`} {...rest} />
      {error && <Icon name="alert" className="size-3.5 shrink-0 text-danger-ink" />}
    </Shell>
  );
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`block w-full resize-y edge bg-surface px-2.5 py-2 font-mono text-xs leading-[19px] text-fg-2 lift-sm focus-ring disabled:cursor-not-allowed disabled:border-fg-3 disabled:bg-subtle disabled:text-fg-3 disabled:shadow-none ${className}`}
      {...rest}
    />
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel: string;
  /** Stretch to the container, segments sharing the width. */
  block?: boolean;
}

export function Segmented<T extends string>({ value, onChange, options, disabled, ariaLabel, block = false }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`${block ? "flex w-full" : "inline-flex"} overflow-hidden edge ${disabled ? "border-fg-3 bg-subtle" : "bg-surface lift-sm"}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`${block ? "min-w-0 flex-auto px-2 tracking-[.06em]" : "px-3"} h-[calc(var(--ctl-h)-4px)] edge-l label-caps text-[11px] focus-ring first:border-l-0 disabled:cursor-not-allowed disabled:border-fg-3 disabled:text-fg-3 ${
              on ? "bg-seg-on-bg text-seg-on-fg disabled:bg-subtle-2" : "text-fg-2 hover:bg-subtle hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function Checkbox({ checked, onChange, disabled, ariaLabel }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`inline-flex size-[18px] shrink-0 items-center justify-center edge focus-ring disabled:cursor-not-allowed disabled:border-fg-3 disabled:bg-subtle disabled:text-fg-3 ${
        checked ? "bg-primary text-primary-fg" : "bg-surface hover:bg-acid"
      }`}
    >
      {checked && <Icon name="check" className="size-[11px]" />}
    </button>
  );
}
