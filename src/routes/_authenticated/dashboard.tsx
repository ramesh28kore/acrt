import { createFileRoute, redirect } from "@tanstack/react-router";
import { meQuery, ROLE_HOME } from "@/lib/me";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me?.primary) throw redirect({ to: ROLE_HOME[me.primary] });
  },
  head: () => ({ meta: [{ title: "Dashboard — Avanthi CRT Portal" }] }),
  component: () => (
    <AppShell title="No role assigned yet">
      <p className="text-muted-foreground">
        Your account exists but hasn't been given a role. Please ask your college admin to set it up.
      </p>
    </AppShell>
  ),
});
