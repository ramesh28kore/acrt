import { Check, Minus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Overview } from "@/lib/super-admin.contracts";
import { ROLE_LABEL, type Role } from "@/lib/me";
import { RoleBadge } from "./shared";

const roles: Role[] = ["student", "faculty", "admin", "super_admin"];
const permissions = [
  ["Read own profile", "Yes", "Yes", "Yes", "Yes"],
  ["Read institute roster", "—", "Own institute", "Own institute", "All institutes"],
  ["View administrative activity", "—", "—", "Own institute", "All institutes"],
  ["Open this management panel", "—", "—", "—", "Yes"],
  ["Manage students & faculty", "—", "—", "Own institute", "All institutes"],
  ["Assign admin roles & institutes", "—", "—", "—", "Yes"],
  ["Create & edit institutes", "—", "—", "—", "Yes"],
];
export function RolesPanel({ data, onUsers }: { data: Overview; onUsers: () => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => (
          <section key={role} className="rounded-xl border border-slate-200 bg-white p-5">
            <RoleBadge role={role} />
            <p className="mt-4 text-3xl font-semibold text-slate-900">{data.roles[role] ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">Assigned accounts</p>
          </section>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">Access by role</h2>
            <p className="mt-1 text-xs text-slate-500">
              Current portal permissions. Manage role assignments from the user directory.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onUsers}>
            Manage assignments
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-4">Permission</th>
                {roles.map((role) => (
                  <th className="whitespace-nowrap px-4 py-4" key={role}>
                    {ROLE_LABEL[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {permissions.map(([permission, ...values]) => (
                <tr key={permission}>
                  <th className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-700">
                    {permission}
                  </th>
                  {values.map((value, index) => (
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500" key={index}>
                      {value === "Yes" ? (
                        <Check aria-label="Allowed" className="size-4 text-teal-600" />
                      ) : value === "—" ? (
                        <Minus aria-label="Not allowed" className="size-4 text-slate-300" />
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="flex items-start gap-3 rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm text-teal-900">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" />
        <p className="leading-relaxed">
          Super admin access applies across all institutes. Your own role and access are protected,
          and role changes are recorded in Activity.
        </p>
      </div>
    </div>
  );
}
