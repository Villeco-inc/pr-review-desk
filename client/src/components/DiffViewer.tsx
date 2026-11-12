import Icon from "./ui/Icon";
import { parsePatch, type DiffLine } from "../lib/diff";

function isHighlighted(line: DiffLine, side: "LEFT" | "RIGHT" | undefined, start?: number, end?: number): boolean {
  if (start == null || end == null) return false;
  const lineNo = side === "LEFT" ? line.oldLine : line.newLine;
  if (lineNo == null) return false;
  return lineNo >= start && lineNo <= end;
}

const ROW: Record<Exclude<DiffLine["type"], "hunk">, { row: string; ln: string; tx: string }> = {
  add: { row: "bg-diff-add-bg", ln: "bg-diff-add-gutter text-diff-add-ln", tx: "text-diff-add-fg" },
  del: { row: "bg-diff-del-bg", ln: "bg-diff-del-gutter text-diff-del-ln", tx: "text-diff-del-fg" },
  context: { row: "bg-surface", ln: "bg-subtle text-fg-3", tx: "text-fg-2" },
};
const HL = { row: "bg-diff-hl-bg", ln: "bg-diff-hl-gutter text-diff-hl-ln", tx: "text-diff-hl-fg" };

export default function DiffViewer({
  patch,
  file,
  highlightStart,
  highlightEnd,
  side = "RIGHT",
}: {
  patch: string;
  file?: string;
  highlightStart?: number | null;
  highlightEnd?: number | null;
  side?: "LEFT" | "RIGHT";
}) {
  const lines = parsePatch(patch);
  const start = highlightStart ?? undefined;
  const end = highlightEnd ?? start;
  const adds = lines.filter((l) => l.type === "add").length;
  const dels = lines.filter((l) => l.type === "del").length;

  return (
    <div className="overflow-hidden edge bg-surface lift">
      {file && (
        <div className="flex h-[38px] items-center gap-3 edge-b bg-subtle pl-3.5 pr-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-2">
            <Icon name="file" className="size-3.5 text-fg-3" />
            {file}
          </span>
          <span className="font-mono text-xs">
            <span className="text-success-ink">+{adds}</span> <span className="text-danger-ink">−{dels}</span>
          </span>
          {start != null && (
            <span className="ml-auto inline-flex items-center gap-1.5 label-caps text-fg-2">
              <span className="size-3 edge bg-diff-hl-bg" />
              finding range · {side} {start}
              {end != null && end !== start ? `–${end}` : ""}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {lines.map((line, idx) => {
              if (line.type === "hunk") {
                return (
                  <tr key={idx}>
                    <td
                      colSpan={4}
                      className="h-[26px] whitespace-pre bg-diff-hunk-bg pl-3.5 text-[length:calc(11px*var(--font-scale))] text-diff-hunk-fg"
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              }

              const hl = isHighlighted(line, side, start, end);
              const s = hl ? HL : ROW[line.type];
              const prefix = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";

              return (
                <tr key={idx} className={s.row}>
                  <td className={`h-[22px] w-11 min-w-11 select-none whitespace-pre edge-soft-r pr-2 text-right ${s.ln}`}>{line.oldLine ?? ""}</td>
                  <td className={`h-[22px] w-11 min-w-11 select-none whitespace-pre edge-r pr-2 text-right ${s.ln}`}>{line.newLine ?? ""}</td>
                  <td className={`w-[22px] min-w-[22px] select-none text-center ${s.tx} ${hl ? "shadow-[inset_5px_0_0_var(--color-diff-hl-marker)]" : ""}`}>{prefix}</td>
                  <td className={`whitespace-pre pr-3 ${s.tx}`}>{line.content}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
