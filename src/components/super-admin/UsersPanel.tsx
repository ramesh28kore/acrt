import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardUsers } from "@/lib/super-admin.functions";
import type { Institute, ManagedUser, UserFilters } from "@/lib/super-admin.contracts";
import type { Role } from "@/lib/me";
import {
  FilterSelect,
  InstituteOptions,
  Pagination,
  RoleBadge,
  RoleOptions,
  SearchField,
  StateMessage,
  StatusBadge,
} from "./shared";
import { initials } from "./display";

export function UsersPanel({
  institutes,
  adminsOnly,
  initialInstitute,
  onEdit,
}: {
  institutes: Institute[];
  adminsOnly?: boolean;
  initialInstitute?: string | undefined;
  onEdit: (user: ManagedUser) => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<UserFilters>({
    search: "",
    role: adminsOnly ? "admin" : null,
    instituteId: initialInstitute ?? null,
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
    queryKey: ["super-admin", "users", filters],
    queryFn: () => dashboardUsers({ data: filters }),
    retry: 1,
  });
  function filter(next: Partial<UserFilters>) {
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">
            {adminsOnly ? "Institute administrators" : "User directory"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {adminsOnly
              ? "Manage the people responsible for each institute."
              : "Find an account to manage its profile, role, and access."}
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <Users className="size-3.5" />
          {query.data?.total ?? "—"} {adminsOnly ? "admins" : "users"}
        </span>
      </div>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search name, email, or roll number"
        />
        {!adminsOnly && (
          <FilterSelect
            aria-label="Filter by role"
            value={filters.role ?? ""}
            onChange={(event) => filter({ role: (event.target.value || null) as Role | null })}
          >
            <option value="">All roles</option>
            <RoleOptions />
          </FilterSelect>
        )}
        <FilterSelect
          aria-label="Filter by institute"
          value={filters.instituteId ?? ""}
          onChange={(event) => filter({ instituteId: event.target.value || null })}
        >
          <option value="">All institutes</option>
          <InstituteOptions institutes={institutes} />
        </FilterSelect>
        <FilterSelect
          aria-label="Filter by access"
          value={filters.active === null ? "" : String(filters.active)}
          onChange={(event) =>
            filter({ active: event.target.value === "" ? null : event.target.value === "true" })
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
      ) : query.data.items.length === 0 ? (
        <StateMessage>
          No users match these filters. Try a different name or clear the filters.
        </StateMessage>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Institute</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-5 py-3">
                  <span className="sr-only">Manage</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.items.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {initials(user.full_name || user.email)}
                      </span>
                      <div>
                        <div className="font-medium text-slate-800">
                          {user.full_name || "Unnamed user"}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{user.email}</div>
                        {user.roll_number && (
                          <div className="mt-1 text-[11px] text-slate-400">{user.roll_number}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length ? (
                        user.roles.map((role) => <RoleBadge key={role} role={role} />)
                      ) : (
                        <span className="text-xs text-amber-700">Unassigned</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs font-medium text-slate-600">
                      {user.institute_code ?? "Global"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge active={user.is_active} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(user)}
                      aria-label={`Manage ${user.full_name || user.email}`}
                    >
                      Manage
                      <ArrowUpRight className="size-3.5" />
                    </Button>
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
