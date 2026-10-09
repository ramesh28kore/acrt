import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { meQuery } from "@/lib/me";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me?.profile && !me.profile.is_active) {
      await supabase.auth.signOut();
      context.queryClient.clear();
      throw redirect({ to: "/auth", search: { redirect: undefined } });
    }
  },
  component: () => <Outlet />,
});
