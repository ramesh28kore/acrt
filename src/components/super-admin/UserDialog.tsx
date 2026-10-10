import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
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
import { dashboardCreateUser, dashboardUpdateUser } from "@/lib/super-admin.functions";
import {
  createAccountSchema,
  editUserSchema,
  type ManagedUser,
  type Institute,
} from "@/lib/super-admin.contracts";
import type { Role } from "@/lib/me";
import { FilterSelect, InstituteOptions, RoleOptions } from "./shared";
import { dateLabel } from "./display";

export function UserDialog({
  user,
  institutes,
  currentUserId,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  institutes: Institute[];
  currentUserId: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [roll, setRoll] = useState(user?.roll_number ?? "");
  const [role, setRole] = useState<Role>(
    (["super_admin", "admin", "faculty", "student"] as Role[]).find((value) =>
      user?.roles.includes(value),
    ) ?? "student",
  );
  const [institute, setInstitute] = useState(user?.institute_id ?? "");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [error, setError] = useState("");
  const self = user?.id === currentUserId;
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        full_name: name,
        roll_number: roll,
        role,
        institute_id: institute || null,
        is_active: active,
      };
      if (role !== "super_admin" && !institute)
        throw new Error("Choose an institute for this role.");
      if (user) {
        const parsed = editUserSchema.safeParse({ ...fields, user_id: user.id });
        if (!parsed.success)
          throw new Error(parsed.error.issues[0]?.message ?? "Check the user details.");
        return dashboardUpdateUser({ data: parsed.data });
      }
      const parsed = createAccountSchema.safeParse({ ...fields, email, password });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? "Check the user details.");
      return dashboardCreateUser({ data: parsed.data });
    },
    onSuccess: async () => {
      setPassword("");
      await onSaved(
        user
          ? "User details and access updated."
          : "Account created. The user can now sign in with the credentials you set.",
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
          <DialogTitle>{user ? "User details & access" : "Create a user"}</DialogTitle>
          <DialogDescription>
            {user
              ? "Update this account’s details and portal permissions."
              : "Set up an account and assign its institute and role."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Full name</Label>
            <Input
              id="user-name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email address</Label>
            <Input
              id="user-email"
              type="email"
              required
              disabled={Boolean(user)}
              maxLength={255}
              value={email}
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {!user && (
            <div className="space-y-1.5">
              <Label htmlFor="user-password">Initial password</Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="password-help"
              />
              <p id="password-help" className="text-xs text-slate-500">
                At least 12 characters with uppercase, lowercase, a number, and a symbol. Share it
                securely with the user.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="user-role">Role</Label>
              <FilterSelect
                id="user-role"
                value={role}
                disabled={self}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <RoleOptions />
              </FilterSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-roll">Roll / employee number</Label>
              <Input
                id="user-roll"
                maxLength={40}
                value={roll}
                onChange={(event) => setRoll(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="user-institute">Institute</Label>
            <FilterSelect
              id="user-institute"
              required={role !== "super_admin"}
              value={institute}
              disabled={self}
              onChange={(event) => setInstitute(event.target.value)}
            >
              <option value="">
                {role === "super_admin" ? "Global / no institute" : "Choose an institute"}
              </option>
              <InstituteOptions institutes={institutes} />
            </FilterSelect>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={active}
              disabled={self}
              onChange={(event) => setActive(event.target.checked)}
              className="mt-1 accent-teal-700"
            />
            <span>
              <span className="block text-sm font-medium">Portal access enabled</span>
              <span className="text-xs text-slate-500">
                Disabling access blocks this user from the portal.
              </span>
            </span>
          </label>
          {self && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="size-4 shrink-0" />
              Your own role, institute, and access are protected.
            </p>
          )}
          {user && (
            <p className="text-xs text-slate-400">
              Joined {dateLabel(user.created_at)}
              {user.disabled_at ? ` · Access disabled ${dateLabel(user.disabled_at)}` : ""}
            </p>
          )}
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
              className="bg-teal-700 hover:bg-teal-800"
              disabled={save.isPending}
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
