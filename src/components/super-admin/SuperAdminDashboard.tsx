import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Activity,
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
import { dashboardOverview } from "@/lib/super-admin.functions";
import type { ManagedUser } from "@/lib/super-admin.contracts";
import { OverviewPanel } from "./OverviewPanel";
import { UsersPanel } from "./UsersPanel";
import { UserDialog } from "./UserDialog";
import { InstitutesPanel } from "./InstitutesPanel";
import { RolesPanel } from "./RolesPanel";
import { ActivityPanel } from "./ActivityPanel";
import { StateMessage } from "./shared";
import { initials } from "./display";

const navigation = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Your portal at a glance. Every institute, every account.",
  },
  {
    id: "users",
    label: "Users",
    icon: Users,
    description: "One place to manage your portal’s people and their access.",
  },
  {
    id: "admins",
    label: "Admins",
    icon: ShieldCheck,
    description: "The administrators keeping your institutes connected.",
  },
  {
    id: "institutes",
    label: "Institutes",
    icon: Building2,
    description: "Your campuses, their people, and a shared learning environment.",
  },
  {
    id: "roles",
    label: "Roles & access",
    icon: ShieldCheck,
    description: "Understand permissions and keep the right access with the right people.",
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    description: "Follow account changes and sign-ins across the portal.",
  },
] as const;
type Section = (typeof navigation)[number]["id"];

export function SuperAdminDashboard() {
  const { data: me } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userEditor, setUserEditor] = useState<ManagedUser | null | undefined>();
  const [instituteFilter, setInstituteFilter] = useState<string>();
  const [notice, setNotice] = useState("");
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const overview = useQuery({
    queryKey: ["super-admin", "overview"],
    queryFn: () => dashboardOverview(),
    staleTime: 30_000,
    retry: 1,
  });
  const selected = navigation.find((item) => item.id === section)!;
  const name = me?.profile?.full_name || me?.user.email || "Super Admin";
  function show(next: Section) {
    setSection(next);
    setInstituteFilter(undefined);
    setMobileOpen(false);
  }
  function showUsers(institute?: string) {
    setInstituteFilter(institute);
    setSection("users");
    setMobileOpen(false);
  }
  async function saved(message: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["super-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
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
    <div className="min-h-dvh bg-slate-50 text-slate-900 selection:bg-teal-100">
      <a
        href="#super-admin-main"
        className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        aria-label="Super admin navigation"
        className={`fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-white ${mobileOpen ? "flex" : "hidden lg:flex"}`}
      >
        <div className="flex h-20 items-center gap-3 px-6">
          <span className="grid size-10 place-items-center rounded-xl bg-teal-700 text-white">
            <GraduationCap className="size-6" />
          </span>
          <div>
            <span className="text-lg font-bold tracking-tight">
              avanthi<span className="text-teal-600">.</span>
            </span>
            <p className="text-[10px] font-medium tracking-[0.18em] text-slate-400">CRT PORTAL</p>
          </div>
          <button
            aria-label="Close navigation"
            className="ml-auto p-1 text-slate-400 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-6 pb-4 pt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Workspace
        </div>
        <nav className="space-y-1 px-3">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => show(item.id)}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-medium transition-colors focus-visible:outline-teal-600 ${section === item.id ? "bg-teal-50 text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <item.icon
                className={`size-[18px] ${section === item.id ? "text-teal-700" : "text-slate-400"}`}
              />
              {item.label}
              {section === item.id && (
                <span className="ml-auto size-1.5 rounded-full bg-teal-600" />
              )}
            </button>
          ))}
        </nav>
        <div className="mx-5 mt-auto mb-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <ShieldCheck className="size-5 text-teal-700" />
          <p className="mt-3 text-xs font-semibold text-slate-700">Super admin workspace</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            Manage access and activity across all Avanthi institutes.
          </p>
        </div>
        <div className="border-t border-slate-100 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-medium text-white">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-700">{name}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">Super Admin</p>
            </div>
            <Button
              aria-label="Sign out"
              title="Sign out"
              variant="ghost"
              size="icon"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogOut className="size-4 text-slate-400" />
            </Button>
          </div>
          {signOutError && (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {signOutError}
            </p>
          )}
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="flex h-20 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <span className="hidden text-xs text-slate-400 sm:inline">Workspace</span>
            <ChevronRight className="hidden size-3 text-slate-300 sm:block" />
            <span className="text-xs font-medium text-slate-600">{selected.label}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-slate-400 md:block">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-[10px] font-semibold text-teal-700">
              SUPER ADMIN
            </span>
          </div>
        </header>
        <main id="super-admin-main" className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-700">
                AVANTHI ADMINISTRATION
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                {selected.label}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                {selected.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                aria-label="Refresh dashboard"
                disabled={overview.isFetching}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["super-admin"] })}
              >
                <RefreshCw className={overview.isFetching ? "animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                className="bg-teal-700 shadow-sm hover:bg-teal-800"
                disabled={!overview.data}
                onClick={() => setUserEditor(null)}
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
                <OverviewPanel
                  data={overview.data}
                  onUsers={showUsers}
                  onActivity={() => show("activity")}
                />
              )}
              {(section === "users" || section === "admins") && (
                <UsersPanel
                  key={`${section}-${instituteFilter ?? "all"}`}
                  institutes={overview.data.institutes}
                  adminsOnly={section === "admins"}
                  initialInstitute={instituteFilter}
                  onEdit={setUserEditor}
                />
              )}
              {section === "institutes" && (
                <InstitutesPanel
                  institutes={overview.data.institutes}
                  onUsers={showUsers}
                  onSaved={saved}
                />
              )}
              {section === "roles" && (
                <RolesPanel data={overview.data} onUsers={() => showUsers()} />
              )}
              {section === "activity" && <ActivityPanel institutes={overview.data.institutes} />}
            </>
          )}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>Avanthi CRT Portal · Administration</span>
            {overview.dataUpdatedAt > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-teal-500" />
                Data refreshed{" "}
                {new Date(overview.dataUpdatedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </footer>
        </main>
      </div>
      {userEditor !== undefined && overview.data && me && (
        <UserDialog
          key={userEditor?.id ?? "new"}
          user={userEditor}
          institutes={overview.data.institutes}
          currentUserId={me.user.id}
          onClose={() => setUserEditor(undefined)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
