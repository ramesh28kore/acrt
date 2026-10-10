import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardActivity } from "@/lib/super-admin.functions";
import {
  ACTION_LABELS,
  activityCsv,
  type Activity,
  type ActivityFilters,
  type Institute,
} from "@/lib/super-admin.contracts";
import type { Role } from "@/lib/me";
import {
  FilterSelect,
  InstituteOptions,
  Pagination,
  RoleBadge,
  RoleOptions,
  SearchField,
  StateMessage,
} from "./shared";
import { dateLabel } from "./display";

export function ActivityTable({ rows, compact = false }: { rows: Activity[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-5 py-3">Activity</th>
            <th className="px-4 py-3">By</th>
            {!compact && <th className="px-4 py-3">Institute</th>}
            <th className="px-4 py-3">Date</th>
            {!compact && <th className="px-5 py-3">Time</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/50">
              <td className="px-5 py-4">
                <p className="whitespace-nowrap font-medium text-slate-700">
                  {ACTION_LABELS[row.action] ?? row.action.replaceAll("_", " ")}
                </p>
                <p className="mt-1 max-w-60 truncate text-xs text-slate-400">
                  {row.target_name ??
                    (typeof row.details["name"] === "string"
                      ? row.details["name"]
                      : (row.actor_email ?? "Portal activity"))}
                </p>
                {!compact && Object.keys(row.details).length > 0 && (
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="w-fit cursor-pointer hover:text-teal-700">
                      View details
                    </summary>
                    <pre className="mt-2 max-w-80 whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-[11px]">
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  </details>
                )}
              </td>
              <td className="px-4 py-4">
                <p className="whitespace-nowrap text-xs text-slate-600">{row.actor_name}</p>
                <div className="mt-1.5 flex gap-1">
                  {row.actor_roles.map((role) => (
                    <RoleBadge key={role} role={role} />
                  ))}
                </div>
              </td>
              {!compact && (
                <td className="px-4 py-4 text-xs text-slate-500">
                  {row.institute_code ?? "Global"}
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                {dateLabel(row.created_at)}
              </td>
              {!compact && (
                <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">
                  {new Date(row.created_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ActivityPanel({ institutes }: { institutes: Institute[] }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ActivityFilters>({
    search: "",
    action: "",
    role: null,
    instituteId: null,
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
    queryKey: ["super-admin", "activity", filters],
    queryFn: () => dashboardActivity({ data: filters }),
    retry: 1,
  });
  function filter(next: Partial<ActivityFilters>) {
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  }
  function download() {
    if (!query.data) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + activityCsv(query.data.items)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `avanthi-activity-page-${filters.page}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">Activity log</h2>
          <p className="mt-1 text-xs text-slate-500">
            Account, institute, and sign-in records. Times shown in your local timezone.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!query.data?.items.length || query.isFetching}
          onClick={download}
        >
          <Download />
          Export this page
        </Button>
      </div>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">
        <SearchField label="Search people or activity" value={search} onChange={setSearch} />
        <FilterSelect
          aria-label="Filter activity type"
          value={filters.action}
          onChange={(event) => filter({ action: event.target.value })}
        >
          <option value="">All activities</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label="Filter actor role"
          value={filters.role ?? ""}
          onChange={(event) => filter({ role: (event.target.value || null) as Role | null })}
        >
          <option value="">All roles</option>
          <RoleOptions />
        </FilterSelect>
        <FilterSelect
          aria-label="Filter activity institute"
          value={filters.instituteId ?? ""}
          onChange={(event) => filter({ instituteId: event.target.value || null })}
        >
          <option value="">All institutes</option>
          <InstituteOptions institutes={institutes} />
        </FilterSelect>
      </div>
      {query.isPending || query.isError ? (
        <StateMessage
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !query.data.items.length ? (
        <StateMessage>No activity matches your filters.</StateMessage>
      ) : (
        <ActivityTable rows={query.data.items} />
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
