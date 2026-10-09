import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { meQuery, type Role } from "./me";

// UX gate only — data access is enforced by server functions and row-level security.
export function roleGuard(allowed: Role[]) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me || !me.roles.some((r) => allowed.includes(r))) {
      throw redirect({ to: "/dashboard" });
    }
  };
}
