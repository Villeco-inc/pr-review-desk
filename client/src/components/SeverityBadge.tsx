const LABELS: Record<string, string> = { blocker: "Blocker", high: "High", medium: "Medium", low: "Low", nit: "Nit" };

const STYLES: Record<string, string> = {
  blocker: "bg-sev-blocker-bg text-sev-blocker-fg",
  high: "bg-sev-high-bg text-sev-high-fg",
  medium: "bg-sev-medium-bg text-sev-medium-fg",
  low: "bg-sev-low-bg text-sev-low-fg",
  nit: "bg-sev-nit-bg text-sev-nit-fg",
};

export default function SeverityBadge({
  severity,
  count,
  className = "",
}: {
  severity: string;
  count?: number;
  className?: string;
}) {
  const s = STYLES[severity] ?? STYLES.nit;
  return (
    <span
      className={`inline-flex h-[26px] items-center whitespace-nowrap edge px-2 label-caps text-[length:calc(11px*var(--font-scale))] tracking-[.07em] leading-none ${
        count !== undefined ? "font-mono" : ""
      } ${s} ${className}`}
    >
      {count !== undefined ? count : LABELS[severity] ?? severity}
    </span>
  );
}
