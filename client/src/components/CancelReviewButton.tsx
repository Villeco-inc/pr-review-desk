import { useMutation } from "../hooks/useApi";
import Button from "./ui/Button";
import Icon from "./ui/Icon";
import { useToast } from "./ui/Toast";

/** Stops the review running on this target; nothing is recorded and nothing is notified. */
export default function CancelReviewButton({ repo, number, onDone }: { repo: string; number: number; onDone: () => void }) {
  const cancel = useMutation<{ ok: true }>("__cancel__", "POST");
  const { toast } = useToast();
  return (
    <Button
      disabled={cancel.loading}
      onClick={async () => {
        try {
          await cancel.mutate({}, `/api/reviews/${repo}/${number}/cancel`);
        } catch (err) {
          toast({ kind: "error", message: `Could not cancel the review: ${(err as Error).message}` });
        }
        onDone();
      }}
    >
      <Icon name="stop" />
      Cancel review
    </Button>
  );
}
