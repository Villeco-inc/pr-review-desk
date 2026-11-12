import { useStoredState } from "../lib/storage";
import { Textarea } from "./ui/Field";

/** Free text for the review agent, kept per review target for this tab: what to focus on, what it cannot see in the diff. */
export function useReviewInstructions(target: string) {
  const [stored, setStored] = useStoredState("session", `prd:instructions:${target}`, { text: "" });
  return [stored.text, (text: string) => setStored({ text })] as const;
}

export default function ReviewInstructions({ id, value, onChange, disabled }: { id: string; value: string; onChange: (text: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 edge-t bg-subtle px-5 py-3">
      <label htmlFor={id} className="label-caps text-fg-3">
        Instructions for the review agent <span className="normal-case tracking-normal">(optional, sent with this run)</span>
      </label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={4000}
        placeholder="What to focus on, context the diff does not show, what to leave alone…"
      />
    </div>
  );
}
