import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Drop the offset shadow when the block does not sit directly on the page. */
  flat?: boolean;
}

export default function Card({ flat = false, className = "", ...rest }: CardProps) {
  return <div className={`edge bg-surface ${flat ? "" : "lift"} ${className}`} {...rest} />;
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 edge-b px-4 h-12 ${className}`}>{children}</div>;
}

type Tone = "neutral" | "info" | "problem" | "summary";

// Label band: the strip that carries a block's section title — a fill in brutalism, a coloured label in blueprint.
const TONES: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg",
  info: "bg-tone-info-bg text-tone-info-fg",
  problem: "bg-tone-problem-bg text-tone-problem-fg",
  summary: "bg-tone-summary-bg text-tone-summary-fg",
};

export function Eyebrow({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`inline-flex h-6 items-center px-2 label-caps ${TONES[tone]} ${className}`}>{children}</span>;
}

/** Full-width label band across the top of a section inside a block. */
export function Band({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <div className={`flex h-7 shrink-0 items-center gap-2 edge-b px-5 label-caps ${TONES[tone]} ${className}`}>{children}</div>;
}

export function Chip({ children, mono = false, className = "" }: { children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center edge bg-surface px-1.5 leading-none text-fg ${
        mono ? "font-mono text-[length:calc(11px*var(--font-scale))] font-medium" : "label-caps"
      } ${className}`}
    >
      {children}
    </span>
  );
}
