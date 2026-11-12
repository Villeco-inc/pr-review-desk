import { useState } from "react";
import { useMutation } from "../hooks/useApi";
import { fetchJson } from "../lib/api";
import Button from "./ui/Button";
import { Input } from "./ui/Field";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toast";

/** Approves the PR on GitHub with an optional comment; asks first when findings are left open or a CI check failed. */
export default function ApproveButton({ repo, number }: { repo: string; number: number }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [checking, setChecking] = useState(false);
  const submit = useMutation<{ url: string }>("__submit__", "POST");
  const { toast } = useToast();

  const approve = async () => {
    setChecking(true);
    try {
      const { warnings } = await fetchJson<{ warnings: string[] }>(`/api/reviews/${repo}/${number}/approval-check`);
      if (warnings.length > 0 && !window.confirm(`Approve anyway?\n\n${warnings.map((w) => `• ${w}`).join("\n")}`)) return;
      const res = await submit.mutate({ event: "APPROVE", body: comment }, `/api/reviews/${repo}/${number}/submit`);
      toast({ kind: "success", message: `Approved #${number}`, link: { href: res.url, label: "View" } });
      setOpen(false);
      setComment("");
    } catch (err) {
      toast({ kind: "error", message: `Could not approve: ${(err as Error).message}` });
    } finally {
      setChecking(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Icon name="check" />
        Approve
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Input id="approve-comment" wrapperClassName="w-[calc(260px*var(--font-scale))]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" autoFocus />
      <Button size="sm" variant="primary" onClick={approve} disabled={checking || submit.loading}>
        <Icon name="check" />
        Approve
      </Button>
      <Button size="sm" variant="quiet" iconOnly aria-label="Cancel approval" onClick={() => setOpen(false)}>
        <Icon name="x" />
      </Button>
    </span>
  );
}
