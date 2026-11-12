import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "acid" | "plain" | "danger" | "quiet";
type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-1.5 label-caps whitespace-nowrap cursor-pointer select-none focus-ring disabled:cursor-not-allowed disabled:pointer-events-none";

// A block that cannot be pressed has nothing to press into: disabled drops the shadow, never goes translucent.
const BLOCK =
  "edge lift-sm press disabled:bg-subtle disabled:border-fg-3 disabled:text-fg-3 disabled:shadow-none";

const VARIANTS: Record<Variant, string> = {
  primary: `${BLOCK} bg-primary text-primary-fg hover:bg-primary-hover`,
  acid: `${BLOCK} bg-acid text-acid-fg`,
  plain: `${BLOCK} bg-surface text-fg`,
  danger: `${BLOCK} bg-danger text-danger-fg`,
  quiet: "edge border-transparent bg-transparent text-fg-2 transition-colors duration-[80ms] hover:bg-subtle hover:text-fg disabled:text-fg-3",
};

const SIZES: Record<Size, string> = {
  md: "h-[var(--ctl-h)] px-3.5 text-[length:calc(12px*var(--font-scale))] [&_svg]:size-[15px]",
  sm: "h-8 px-2.5 text-[length:calc(11px*var(--font-scale))] [&_svg]:size-3.5",
};

export function buttonClass(variant: Variant = "plain", size: Size = "md", iconOnly = false, extra = "") {
  return [BASE, VARIANTS[variant], SIZES[size], iconOnly ? (size === "sm" ? "w-8 px-0" : "w-[var(--ctl-h)] px-0") : "", extra]
    .filter(Boolean)
    .join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
  children?: ReactNode;
}

export default function Button({ variant = "plain", size = "md", iconOnly = false, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, iconOnly, className)} {...rest} />;
}

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function LinkButton({ variant = "plain", size = "md", className = "", ...rest }: LinkButtonProps) {
  return <a className={buttonClass(variant, size, false, `no-underline hover:no-underline ${className}`)} {...rest} />;
}
