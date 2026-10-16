import Icon from "./Icon";

interface PagerProps {
  /** e.g. "PR 1 of 7" */
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev?: () => void;
  onNext?: () => void;
  prevKey?: string;
  nextKey?: string;
}

// The end of the range is disabled, never hidden, so the control does not move under the cursor.
const BTN =
  "inline-flex h-[30px] w-8 items-center justify-center bg-surface text-fg hover:bg-acid hover:text-acid-fg focus-ring disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-3 [&_svg]:size-4";

export default function Pager({ label, prevLabel, nextLabel, onPrev, onNext, prevKey, nextKey }: PagerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="label-caps text-fg-3">{label}</span>
      <div role="group" aria-label={label} className="inline-flex overflow-hidden edge">
        <button
          type="button"
          className={BTN}
          aria-label={prevLabel}
          title={prevKey ? `${prevLabel} (${prevKey})` : prevLabel}
          aria-keyshortcuts={prevKey}
          disabled={!onPrev}
          onClick={onPrev}
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          className={`${BTN} edge-l`}
          aria-label={nextLabel}
          title={nextKey ? `${nextLabel} (${nextKey})` : nextLabel}
          aria-keyshortcuts={nextKey}
          disabled={!onNext}
          onClick={onNext}
        >
          <Icon name="chevronRight" />
        </button>
      </div>
    </div>
  );
}
