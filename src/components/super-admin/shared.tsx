import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, Search } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Role } from "@/lib/me";
import type { Institute } from "@/lib/super-admin.contracts";

export function StateMessage({
  error,
  loading,
  retry,
  children,
}: {
  error?: Error | null;
  loading?: boolean;
  retry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
      role={error ? "alert" : "status"}
    >
      {loading ? (
        <Loader2 className="size-6 animate-spin text-teal-700" />
      ) : error ? (
        <AlertCircle className="size-6 text-rose-600" />
      ) : (
        <Inbox className="size-7 text-slate-400" />
      )}
      <p className="max-w-md text-sm text-slate-500">
        {loading ? "Loading your data…" : error ? error.message : children}
      </p>
      {error && retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function FilterSelect({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-slate-400"
    >
      {children}
    </select>
  );
}
export function RoleOptions() {
  return (
    <>
      {Object.entries(ROLE_LABEL).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}
export function InstituteOptions({ institutes }: { institutes: Institute[] }) {
  return (
    <>
      {institutes.map((institute) => (
        <option key={institute.id} value={institute.id}>
          {institute.code} — {institute.name}
        </option>
      ))}
    </>
  );
}
export function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative min-w-48 flex-1">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        maxLength={120}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
      />
    </div>
  );
}
export function Pagination({
  page,
  total,
  onChange,
  busy,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
      <span>
        {total
          ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total.toLocaleString()} records`
          : "0 records"}
      </span>
      <div className="flex items-center gap-3">
        <Button
          aria-label="Previous page"
          size="icon"
          variant="outline"
          disabled={busy || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          aria-label="Next page"
          size="icon"
          variant="outline"
          disabled={busy || page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
export function RoleBadge({ role }: { role: Role }) {
  const colors: Record<Role, string> = {
    super_admin: "bg-violet-50 text-violet-700 ring-violet-100",
    admin: "bg-sky-50 text-sky-700 ring-sky-100",
    faculty: "bg-amber-50 text-amber-700 ring-amber-100",
    student: "bg-teal-50 text-teal-700 ring-teal-100",
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${colors[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${active ? "text-emerald-700" : "text-slate-500"}`}
    >
      <span className={`size-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Disabled"}
    </span>
  );
}
