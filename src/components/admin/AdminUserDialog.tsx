import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Building2 } from "lucide-react";
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
import { adminCreateUser, adminUpdateUser } from "@/lib/admin.functions";
import {
  adminCreateUserSchema,
  adminEditUserSchema,
  type ManagedRole,
} from "@/lib/admin.contracts";
import type { ManagedUser } from "@/lib/super-admin.contracts";
import { FilterSelect } from "../super-admin/shared";

export function AdminUserDialog({
  user,
  initialRole,
  instituteName,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  initialRole: ManagedRole;
  instituteName: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [roll, setRoll] = useState(user?.roll_number ?? "");
  const [role, setRole] = useState<ManagedRole>(
    user?.roles.includes("faculty") ? "faculty" : initialRole,
  );
  const [active, setActive] = useState(user?.is_active ?? true);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const fields = { full_name: name, roll_number: roll, role, is_active: active };
      if (user) {
        const parsed = adminEditUserSchema.safeParse({ ...fields, user_id: user.id });
        if (!parsed.success)
          throw new Error(parsed.error.issues[0]?.message ?? "Check the details.");
        return adminUpdateUser({ data: parsed.data });
      }
      const parsed = adminCreateUserSchema.safeParse({ ...fields, email, password });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the details.");
      return adminCreateUser({ data: parsed.data });
    },
    onSuccess: async () => {
      setPassword("");
      await onSaved(
        user
          ? "Account details and access updated."
          : active
            ? "Account created. Share the credentials securely with the user."
            : "Account created with portal access disabled.",
      );
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
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? "Manage account" : "Create an account"}</DialogTitle>
          <DialogDescription>
            Manage student and faculty access for your institute.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">
          <Building2 className="size-4 shrink-0" />
          {instituteName}
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="admin-name">Full name</Label>
            <Input
              id="admin-name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email address</Label>
            <Input
              id="admin-email"
              type="email"
              required
              disabled={Boolean(user)}
              autoComplete="off"
              maxLength={255}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {!user && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">Initial password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="admin-password-help"
              />
              <p id="admin-password-help" className="text-xs text-slate-500">
                Use at least 12 characters with uppercase, lowercase, a number, and a symbol.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="admin-role">Role</Label>
              <FilterSelect
                id="admin-role"
                value={role}
                onChange={(e) => setRole(e.target.value as ManagedRole)}
              >
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </FilterSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-roll">Roll / employee number</Label>
              <Input
                id="admin-roll"
                maxLength={40}
                value={roll}
                onChange={(e) => setRoll(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="mt-1 accent-indigo-700"
            />
            <span>
              <span className="block text-sm font-medium">Portal access enabled</span>
              <span className="text-xs text-slate-500">
                Disabling access blocks this account from the portal.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={save.isPending}
              className="bg-indigo-700 hover:bg-indigo-800"
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              {user ? "Save changes" : "Create account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
