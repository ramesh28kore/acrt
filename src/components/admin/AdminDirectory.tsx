import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminUsers } from "@/lib/admin.functions";
import { canManageUser, type AdminUserFilters, type ManagedRole } from "@/lib/admin.contracts";
import type { ManagedUser } from "@/lib/super-admin.contracts";
import type { Role } from "@/lib/me";
import {
  FilterSelect,
  Pagination,
  RoleBadge,
  RoleOptions,
  SearchField,
  StateMessage,
  StatusBadge,
} from "../super-admin/shared";
import { dateLabel, initials } from "../super-admin/display";

export function AdminDirectory({
  fixedRole,
  onEdit,
}: {
  fixedRole: ManagedRole | null;
  onEdit: (user: ManagedUser) => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AdminUserFilters>({
    search: "",
    role: fixedRole,
    active: null,
    page: 1,
  });
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, search: search.trim(), page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["admin", "users", filters],
    queryFn: () => adminUsers({ data: filters }),
    retry: 1,
  });
  function filter(next: Partial<AdminUserFilters>) {
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold">
          {fixedRole === "student"
            ? "Student directory"
            : fixedRole === "faculty"
              ? "Faculty directory"
              : "Institute directory"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Search by name, email, or roll number. Admin accounts are managed by the Super Admin.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">
        <SearchField label="Search institute users" value={search} onChange={setSearch} />
        {!fixedRole && (
          <FilterSelect
            aria-label="Filter role"
            value={filters.role ?? ""}
            onChange={(e) => filter({ role: (e.target.value || null) as Role | null })}
          >
            <option value="">All roles</option>
            <RoleOptions />
          </FilterSelect>
        )}
        <FilterSelect
          aria-label="Filter access"
          value={filters.active === null ? "" : String(filters.active)}
          onChange={(e) =>
            filter({ active: e.target.value === "" ? null : e.target.value === "true" })
          }
        >
          <option value="">All access</option>
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </FilterSelect>
      </div>
      {query.isPending || query.isError ? (
        <StateMessage
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !query.data.items.length ? (
        <StateMessage>No accounts match your filters.</StateMessage>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Account</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-5 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.items.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600 sm:flex">
                        {initials(user.full_name || user.email)}
                      </span>
                      <div>
                        <p className="font-medium text-slate-800">
                          {user.full_name || "Unnamed account"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{user.email}</p>
                        {user.roll_number && (
                          <p className="mt-1 text-[11px] text-slate-400">{user.roll_number}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length ? (
                        user.roles.map((role) => <RoleBadge key={role} role={role} />)
                      ) : (
                        <span className="text-xs text-amber-700">Needs a role</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge active={user.is_active} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                    {dateLabel(user.created_at)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {canManageUser(user) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Manage ${user.full_name || user.email}`}
                        onClick={() => onEdit(user)}
                      >
                        Manage
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-400">
                        <LockKeyhole className="size-3" />
                        Protected
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={filters.page}
        total={query.data?.total ?? 0}
        busy={query.isFetching}
        onChange={(page) => setFilters((current) => ({ ...current, page }))}
      />
    </section>
  );
}
