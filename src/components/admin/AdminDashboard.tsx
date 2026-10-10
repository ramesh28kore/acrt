import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { meQuery } from "@/lib/me";
import { adminOverview } from "@/lib/admin.functions";
import type { ManagedUser } from "@/lib/super-admin.contracts";
import type { AdminOverview, ManagedRole } from "@/lib/admin.contracts";
import { StateMessage } from "../super-admin/shared";
import { initials } from "../super-admin/display";
import { AdminDirectory } from "./AdminDirectory";
import { AdminUserDialog } from "./AdminUserDialog";
import { AdminActivity } from "./AdminActivity";

const navigation = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Your institute, at a glance.",
  },
  {
    id: "students",
    label: "Students",
    icon: GraduationCap,
    description: "Manage student accounts and help your learners get started.",
  },
  {
    id: "faculty",
    label: "Faculty",
    icon: BookOpen,
    description: "Keep your teaching team connected to the portal.",
  },
  {
    id: "users",
    label: "All users",
    icon: Users,
    description: "Everyone in your institute, with their current role and access.",
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    description: "Follow account changes and sign-ins in your institute.",
  },
  {
    id: "institute",
    label: "My institute",
    icon: Building2,
    description: "Your campus details and administration responsibilities.",
  },
] as const;
type Section = (typeof navigation)[number]["id"];

export function AdminDashboard() {
  const { data: me } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editor, setEditor] = useState<ManagedUser | null | undefined>();
  const [initialRole, setInitialRole] = useState<ManagedRole>("student");
  const [notice, setNotice] = useState("");
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminOverview(),
    staleTime: 30_000,
    retry: 1,
  });
  const selected = navigation.find((item) => item.id === section)!;
  const name = me?.profile?.full_name || me?.user.email || "Admin";
  function show(next: Section) {
    setSection(next);
    setMobileOpen(false);
  }
  function create(role: ManagedRole) {
    setInitialRole(role);
    setEditor(null);
  }
  function edit(user: ManagedUser) {
    setInitialRole(user.roles.includes("faculty") ? "faculty" : "student");
    setEditor(user);
  }
  async function saved(message: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: ["super-admin"] }),
    ]);
    setNotice(message);
  }
  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await queryClient.cancelQueries();
      queryClient.clear();
      await navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
    } catch {
      setSignOutError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 selection:bg-indigo-100">
      <a
        href="#admin-main"
        className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="admin-navigation"
        className={`${mobileOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-white lg:flex`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-700 text-white">
            <GraduationCap className="size-5" />
          </span>
          <div>
            <p className="text-base font-bold tracking-tight">AVANTHI</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">CRT Portal</p>
          </div>
        </div>
        <div className="mx-4 mb-3 mt-5 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
            Institute workspace
          </p>
          <p className="mt-1 text-sm font-semibold text-indigo-900">
            {overview.data?.institute.code ?? me?.profile?.institutes?.code ?? "Administration"}
          </p>
        </div>
        <nav aria-label="Admin navigation" className="flex-1 space-y-1 px-3 py-2">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => show(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${section === item.id ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <item.icon className="size-[18px]" />
              {item.label}
              {section === item.id && <ChevronRight className="ml-auto size-4" />}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-slate-400">Institute Admin</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-500"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            <LogOut />
            Sign out
          </Button>
          {signOutError && (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {signOutError}
            </p>
          )}
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="flex h-20 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="admin-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <span className="truncate text-xs text-slate-500">
              {overview.data?.institute.name ?? "Avanthi CRT Portal"}
            </span>
          </div>
          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[10px] font-semibold tracking-wide text-indigo-700">
            INSTITUTE ADMIN
          </span>
        </header>
        <main id="admin-main" className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600">
                AVANTHI ADMINISTRATION
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">{selected.label}</h1>
              <p className="mt-2 text-sm text-slate-500">{selected.description}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                aria-label="Refresh dashboard"
                disabled={overview.isFetching}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["admin"] })}
              >
                <RefreshCw className={overview.isFetching ? "animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                className="bg-indigo-700 hover:bg-indigo-800"
                disabled={!overview.data || overview.isError}
                onClick={() => create(section === "faculty" ? "faculty" : "student")}
              >
                <Plus />
                Create user
              </Button>
            </div>
          </div>
          {notice && (
            <div
              role="status"
              className="mb-5 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="flex-1">{notice}</span>
              <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
                <X className="size-4" />
              </button>
            </div>
          )}
          {overview.isPending || overview.isError ? (
            <div className="rounded-xl border border-slate-200 bg-white">
              <StateMessage
                loading={overview.isPending}
                error={overview.error}
                retry={() => void overview.refetch()}
              />
            </div>
          ) : (
            <>
              {section === "overview" && (
                <Overview data={overview.data} onShow={show} onCreate={create} />
              )}
              {(section === "students" || section === "faculty" || section === "users") && (
                <AdminDirectory
                  key={section}
                  fixedRole={
                    section === "students" ? "student" : section === "faculty" ? "faculty" : null
                  }
                  onEdit={edit}
                />
              )}
              {section === "activity" && <AdminActivity />}
              {section === "institute" && <Institute data={overview.data} />}
            </>
          )}
          <footer className="mt-8 flex flex-wrap justify-between gap-2 text-[10px] text-slate-400">
            <span>Avanthi CRT Portal · Institute administration</span>
            {overview.dataUpdatedAt > 0 && (
              <span>
                Updated{" "}
                {new Date(overview.dataUpdatedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </footer>
        </main>
      </div>
      {editor !== undefined && overview.data && (
        <AdminUserDialog
          key={editor?.id ?? `new-${initialRole}`}
          user={editor}
          initialRole={initialRole}
          instituteName={`${overview.data.institute.code} · ${overview.data.institute.name}`}
          onClose={() => setEditor(undefined)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  onShow,
  onCreate,
}: {
  data: AdminOverview;
  onShow: (section: Section) => void;
  onCreate: (role: ManagedRole) => void;
}) {
  const cards = [
    {
      label: "Students",
      count: data.roles["student"] ?? 0,
      detail: "Enrolled accounts",
      icon: GraduationCap,
      section: "students" as const,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Faculty",
      count: data.roles["faculty"] ?? 0,
      detail: "Teaching team accounts",
      icon: BookOpen,
      section: "faculty" as const,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "All accounts",
      count: data.total,
      detail: `${data.roles["admin"] ?? 0} institute administrators`,
      icon: Users,
      section: "users" as const,
      color: "bg-sky-50 text-sky-600",
    },
  ];
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-indigo-950 p-6 text-white sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-14 -top-24 size-80 rounded-full border-[40px] border-white/5"
        />
        <div className="relative">
          <p className="text-xs font-medium text-indigo-300">{data.institute.code} CAMPUS</p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight">
            A connected campus starts here.
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-indigo-200">
            Welcome to {data.institute.name}. Set up your people, manage their access, and keep
            track of what changes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              className="bg-white text-indigo-950 hover:bg-indigo-50"
              onClick={() => onCreate("student")}
            >
              <Plus />
              Add student
            </Button>
            <Button
              className="border border-white/25 bg-white/10 text-white hover:bg-white/20"
              onClick={() => onCreate("faculty")}
            >
              <Plus />
              Add faculty
            </Button>
          </div>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={() => onShow(card.section)}
            className="group rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-indigo-200 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className={`flex size-10 items-center justify-center rounded-lg ${card.color}`}>
                <card.icon className="size-5" />
              </span>
              <ArrowUpRight className="size-4 text-slate-300 group-hover:text-indigo-600" />
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight">
              {card.count.toLocaleString()}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600">{card.label}</p>
            <p className="mt-2 text-xs text-slate-400">{card.detail}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div>
          <AdminActivity compact />
          <button
            onClick={() => onShow("activity")}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
          >
            View all activity
            <ChevronRight className="size-3" />
          </button>
        </div>
        <section className="h-fit rounded-xl border border-slate-200 bg-white p-5">
          <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ShieldCheck className="size-5" />
          </span>
          <h2 className="mt-4 font-semibold">Portal access</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Current account access across your institute.
          </p>
          <div
            className="mt-5 flex h-2 overflow-hidden rounded-full bg-slate-100"
            aria-label={`${data.active} active of ${data.total} accounts`}
          >
            <div
              className="bg-emerald-500"
              style={{ width: `${data.total ? (data.active / data.total) * 100 : 0}%` }}
            />
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Active</dt>
              <dd className="font-medium text-emerald-700">{data.active}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Disabled</dt>
              <dd className="font-medium">{data.disabled}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">No role assigned</dt>
              <dd className="font-medium">{data.unassigned}</dd>
            </div>
          </dl>
          <Button variant="outline" className="mt-5 w-full" onClick={() => onShow("users")}>
            Review accounts
          </Button>
        </section>
      </div>
    </div>
  );
}

function Institute({ data }: { data: AdminOverview }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <span className="flex size-14 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Building2 className="size-7" />
        </span>
        <p className="mt-5 text-xs font-semibold tracking-wider text-indigo-600">
          {data.institute.code}
        </p>
        <h2 className="mt-2 text-xl font-semibold">{data.institute.name}</h2>
        <dl className="mt-6 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-3">
            <dt className="text-slate-500">Total accounts</dt>
            <dd>{data.total}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-slate-500">Admin accounts</dt>
            <dd>{data.roles["admin"] ?? 0}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-slate-500">Active accounts</dt>
            <dd>{data.active}</dd>
          </div>
        </dl>
        <p className="mt-5 text-xs leading-5 text-slate-500">
          Contact the Super Admin to update the institute name, code, or administrator assignments.
        </p>
      </section>
      <section className="h-fit rounded-xl border border-slate-200 bg-white p-6">
        <ShieldCheck className="size-6 text-indigo-600" />
        <h2 className="mt-4 font-semibold">Your administration access</h2>
        <ul className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
          <li>Create student and faculty accounts in {data.institute.code}.</li>
          <li>Update names, roll numbers, student or faculty roles, and portal access.</li>
          <li>Search institute accounts and export pages from the activity log.</li>
        </ul>
        <p className="mt-5 rounded-lg bg-slate-50 p-4 text-xs leading-5 text-slate-500">
          Admin accounts, institute transfers, and campus settings are managed by the Super Admin.
        </p>
      </section>
    </div>
  );
}
