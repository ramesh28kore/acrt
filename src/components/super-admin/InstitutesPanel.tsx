import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Building2, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dashboardSaveInstitute } from "@/lib/super-admin.functions";
import { instituteFieldsSchema, type Institute } from "@/lib/super-admin.contracts";
import { StateMessage } from "./shared";

export function InstitutesPanel({
  institutes,
  onUsers,
  onSaved,
}: {
  institutes: Institute[];
  onUsers: (id: string) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Institute | null | undefined>();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          Manage your institutes and their account directories.
        </p>
        <Button onClick={() => setEditing(null)} className="bg-teal-700 hover:bg-teal-800">
          <Plus />
          Add institute
        </Button>
      </div>
      {!institutes.length ? (
        <StateMessage>Add your first institute to begin assigning users.</StateMessage>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {institutes.map((institute) => (
            <section key={institute.id} className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-start justify-between">
                <span className="grid size-12 place-items-center rounded-xl bg-teal-50 font-semibold text-teal-800">
                  {institute.code}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${institute.code}`}
                  onClick={() => setEditing(institute)}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
              <h2 className="mt-5 font-semibold leading-relaxed text-slate-900">
                {institute.name}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <Building2 className="size-3.5" />
                Institute code: {institute.code}
              </p>
              <div className="my-6 grid grid-cols-3 gap-3 border-y border-slate-100 py-5">
                {[
                  ["Students", institute.students],
                  ["Faculty", institute.faculty],
                  ["Admins", institute.admins],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-2xl font-semibold tracking-tight text-slate-800">
                      {Number(value).toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {institute.active} active / {institute.users} accounts
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-teal-700"
                  onClick={() => onUsers(institute.id)}
                >
                  View users
                  <ArrowUpRight />
                </Button>
              </div>
            </section>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <InstituteDialog
          key={editing?.id ?? "new"}
          institute={editing}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
function InstituteDialog({
  institute,
  onClose,
  onSaved,
}: {
  institute: Institute | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [code, setCode] = useState(institute?.code ?? "");
  const [name, setName] = useState(institute?.name ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const input = instituteFieldsSchema.safeParse({ id: institute?.id ?? null, code, name });
      if (!input.success)
        throw new Error(input.error.issues[0]?.message ?? "Check the institute details.");
      return dashboardSaveInstitute({ data: input.data });
    },
    onSuccess: async () => {
      await onSaved(institute ? "Institute updated." : "Institute added.");
      onClose();
    },
    onError: (error) => setError(error.message),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    save.mutate();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-xl">
        <DialogHeader>
          <DialogTitle>{institute ? "Edit institute" : "Add institute"}</DialogTitle>
          <DialogDescription>
            Use a unique code to identify this institute throughout the portal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="institute-code">Institute code</Label>
            <Input
              id="institute-code"
              required
              minLength={2}
              maxLength={12}
              pattern="[A-Za-z0-9]{2,12}"
              placeholder="e.g. PT"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="institute-name">Institute name</Label>
            <Input
              id="institute-name"
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button className="bg-teal-700 hover:bg-teal-800" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {institute ? "Save institute" : "Add institute"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
