import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorText } from "@/lib/learning/error-text";
import { learningPublish } from "@/lib/learning/learning.functions";
import type { PublishInput } from "@/lib/learning/learning.contracts";

export function PublishToggle({
  kind,
  id,
  published,
  label,
}: Pick<PublishInput, "kind" | "id"> & { published: boolean; label: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => learningPublish({ data: { kind, id, published: !published } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learning"] }),
  });

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        aria-label={`${published ? "Unpublish" : "Publish"} ${label}`}
        className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {published ? "Unpublish" : "Publish"}
      </button>
      {mutation.isError && (
        <span role="alert" className="text-xs text-destructive">
          {errorText(mutation.error)}
        </span>
      )}
    </div>
  );
}
