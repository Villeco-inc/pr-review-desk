import Button from "./Button";
import Card from "./Card";
import Icon from "./Icon";

/** A stale or mistyped URL says so and offers the way out, rather than redirecting silently. */
export default function NotFound({
  title,
  detail,
  backLabel,
  onBack,
}: {
  title: string;
  detail?: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <main className="flex flex-col px-10 pb-10 pt-7">
      <Card role="alert" className="flex flex-col items-start gap-3 p-8">
        <div className="inline-flex size-12 items-center justify-center edge bg-acid text-acid-fg lift-sm">
          <Icon name="alert" className="size-5" />
        </div>
        <span className="font-display text-[length:calc(22px*var(--font-scale))] uppercase leading-none">{title}</span>
        {detail && <span className="max-w-[520px] font-mono text-xs text-fg-3">{detail}</span>}
        <Button variant="acid" className="mt-1" onClick={onBack}>
          <Icon name="arrowLeft" />
          {backLabel}
        </Button>
      </Card>
    </main>
  );
}
