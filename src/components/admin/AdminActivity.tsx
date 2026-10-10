import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminActivity } from "@/lib/admin.functions";
import { ACTION_LABELS, activityCsv } from "@/lib/super-admin.contracts";
import type { AdminActivityFilters } from "@/lib/admin.contracts";
import type { Role } from "@/lib/me";
import { ActivityTable } from "../super-admin/ActivityPanel";
import {
  FilterSelect,
  Pagination,
  RoleOptions,
  SearchField,
  StateMessage,
} from "../super-admin/shared";

export function AdminActivity({ compact = false }: { compact?: boolean }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AdminActivityFilters>({
    search: "",
    action: "",
    role: null,
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
    queryKey: ["admin", "activity", filters],
    queryFn: () => adminActivity({ data: filters }),
    retry: 1,
  });
  function filter(next: Partial<AdminActivityFilters>) {
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  }
  function download() {
    if (!query.data) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + activityCsv(query.data.items)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `institute-activity-page-${filters.page}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold">{compact ? "Recent activity" : "Institute activity"}</h2>
          <p className="mt-1 text-xs text-slate-500">
            Account changes and sign-ins. Times use your local timezone.
          </p>
        </div>
        {!compact && (
          <Button
            variant="outline"
            size="sm"
            disabled={!query.data?.items.length || query.isFetching}
            onClick={download}
          >
            <Download />
            Export this page
          </Button>
        )}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">
          <SearchField label="Search people or activity" value={search} onChange={setSearch} />
          <FilterSelect
            aria-label="Filter activity type"
            value={filters.action}
            onChange={(e) => filter({ action: e.target.value })}
          >
            <option value="">All activities</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            aria-label="Filter actor role"
            value={filters.role ?? ""}
            onChange={(e) => filter({ role: (e.target.value || null) as Role | null })}
          >
            <option value="">All roles</option>
            <RoleOptions />
          </FilterSelect>
        </div>
      )}
      {query.isPending || query.isError ? (
        <StateMessage
          loading={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !query.data.items.length ? (
        <StateMessage>
          {compact
            ? "Your institute's activity will appear here."
            : "No activity matches your filters."}
        </StateMessage>
      ) : (
        <ActivityTable
          rows={compact ? query.data.items.slice(0, 5) : query.data.items}
          compact={compact}
        />
      )}
      {!compact && (
        <Pagination
          page={filters.page}
          total={query.data?.total ?? 0}
          busy={query.isFetching}
          onChange={(page) => setFilters((current) => ({ ...current, page }))}
        />
      )}
    </section>
  );
}
