import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  ShieldCheck,
  Users,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardActivity } from "@/lib/super-admin.functions";
import type { Overview } from "@/lib/super-admin.contracts";
import { ActivityTable } from "./ActivityPanel";
import { StateMessage } from "./shared";

export function OverviewPanel({
  data,
  onUsers,
  onActivity,
}: {
  data: Overview;
  onUsers: (institute?: string) => void;
  onActivity: () => void;
}) {
  const recent = useQuery({
    queryKey: ["super-admin", "recent"],
    queryFn: () =>
      dashboardActivity({
        data: { search: "", action: "", role: null, instituteId: null, page: 1 },
      }),
    retry: 1,
  });
  const activePercent = data.total ? Math.round((data.active / data.total) * 100) : 0;
  const cards = [
    {
      label: "Total users",
      value: data.total,
      caption: `${data.active} with active access`,
      icon: Users,
      color: "bg-teal-50 text-teal-700",
    },
    {
      label: "Students",
      value: data.roles["student"] ?? 0,
      caption: "Learning across institutes",
      icon: GraduationCap,
      color: "bg-sky-50 text-sky-700",
    },
    {
      label: "Faculty",
      value: data.roles["faculty"] ?? 0,
      caption: "Supporting student progress",
      icon: UserRoundCheck,
      color: "bg-amber-50 text-amber-700",
    },
    {
      label: "Administrators",
      value: data.roles["admin"] ?? 0,
      caption: `${data.institutes.length} institutes in your network`,
      icon: ShieldCheck,
      color: "bg-violet-50 text-violet-700",
    },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <section key={card.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <span className={`grid size-9 place-items-center rounded-lg ${card.color}`}>
                <card.icon className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {card.value.toLocaleString()}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">{card.caption}</p>
          </section>
        ))}
      </div>
      {data.unassigned > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <span>
            {data.unassigned} {data.unassigned === 1 ? "account needs" : "accounts need"} a role
            before accessing a dashboard.
          </span>
          <Button variant="ghost" size="sm" onClick={() => onUsers()}>
            Review users
            <ArrowRight />
          </Button>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">Your institutes</h2>
              <p className="mt-1 text-xs text-slate-400">A shared view across every campus</p>
            </div>
            <Building2 className="size-5 text-slate-300" />
          </div>
          <div className="divide-y divide-slate-100">
            {data.institutes.map((institute) => (
              <button
                key={institute.id}
                onClick={() => onUsers(institute.id)}
                className="flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-teal-600"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600">
                  {institute.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-relaxed text-slate-700">
                    {institute.name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {institute.students} students · {institute.faculty} faculty · {institute.admins}{" "}
                    admins
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
          {!data.institutes.length && (
            <StateMessage>No institutes yet. Add one in the Institutes section.</StateMessage>
          )}
        </section>
        <section className="relative overflow-hidden rounded-xl bg-slate-900 p-6 text-white">
          <div
            className="absolute -right-12 -top-12 size-48 rounded-full border-[30px] border-white/[0.025]"
            aria-hidden="true"
          />
          <div className="flex items-center gap-2 text-xs font-medium text-teal-300">
            <ShieldCheck className="size-4" />
            PORTAL ACCESS
          </div>
          <p className="mt-5 text-4xl font-semibold tracking-tight">
            {activePercent}
            <span className="text-xl text-slate-400">%</span>
          </p>
          <h2 className="mt-2 text-sm text-slate-300">of accounts have active access</h2>
          <div
            className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-700"
            role="meter"
            aria-label="Active accounts"
            aria-valuenow={activePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-teal-400 transition-all"
              style={{ width: `${activePercent}%` }}
            />
          </div>
          <div className="mt-4 flex justify-between text-xs text-slate-400">
            <span>
              <span className="text-teal-300">{data.active}</span> active
            </span>
            <span>{data.disabled} disabled</span>
          </div>
          <Button
            variant="ghost"
            className="mt-6 w-full justify-between border border-slate-700 text-xs text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() => onUsers()}
          >
            Manage account access
            <ArrowRight />
          </Button>
        </section>
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Recent activity</h2>
            <p className="mt-1 text-xs text-slate-400">The latest changes across your portal</p>
          </div>
          <Button size="sm" variant="ghost" className="text-teal-700" onClick={onActivity}>
            View all
            <ArrowRight />
          </Button>
        </div>
        {recent.isPending || recent.isError ? (
          <StateMessage
            loading={recent.isPending}
            error={recent.error}
            retry={() => void recent.refetch()}
          />
        ) : recent.data.items.length ? (
          <ActivityTable rows={recent.data.items.slice(0, 5)} compact />
        ) : (
          <StateMessage>Your portal activity will appear here.</StateMessage>
        )}
      </section>
    </div>
  );
}
