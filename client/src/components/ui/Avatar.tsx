import { avatarClass, initials } from "../../lib/format";

export default function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-5 shrink-0 items-center justify-center edge font-mono text-[length:calc(9px*var(--font-scale))] font-bold leading-none text-avatar-fg ${avatarClass(name)} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
