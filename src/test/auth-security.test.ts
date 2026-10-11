import { QueryClient } from "@tanstack/react-query";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertInstituteAdmin } from "@/lib/admin.server";
import { passwordProblem, safeRedirectTarget, signInErrorMessage } from "@/lib/auth-flow";
import { rolesFromProfile, type LiveProfile } from "@/lib/identity";
import { roleGuard } from "@/lib/role-guard";
import { assertSuperAdmin } from "@/lib/super-admin.server";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  profile: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: auth.getUser, signOut: auth.signOut },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => auth.profile,
      };
      return chain;
    },
  },
}));

type FakeClient = Parameters<typeof assertSuperAdmin>[0];

function liveProfile(overrides: Partial<LiveProfile> = {}): LiveProfile {
  return {
    id: "u1",
    role: "student",
    full_name: "Test User",
    email: "user@example.com",
    roll_number: null,
    institute_id: "i1",
    is_super_admin: false,
    is_disabled: false,
    disabled_at: null,
    ...overrides,
  };
}

function fakeClient(profile: LiveProfile | null, failRead = false): FakeClient {
  const result = failRead
    ? { data: null, error: { message: "boom" } }
    : { data: profile, error: null };
  return {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as unknown as FakeClient;
}

describe("role derivation from the profile row", () => {
  it("grants the separate super admin identity only to an active admin with the flag", () => {
    expect(rolesFromProfile(liveProfile({ role: "admin", is_super_admin: true }))).toEqual([
      "super_admin",
      "admin",
    ]);
    expect(rolesFromProfile(liveProfile({ role: "admin" }))).toEqual(["admin"]);
    expect(rolesFromProfile(liveProfile({ role: "student", is_super_admin: true }))).toEqual([
      "student",
    ]);
    expect(rolesFromProfile(liveProfile({ role: "faculty", is_super_admin: true }))).toEqual([
      "faculty",
    ]);
  });

  it("fails closed for disabled, unknown-state or unrecognised accounts", () => {
    const disabledSuper = liveProfile({ role: "admin", is_super_admin: true, is_disabled: true });
    expect(rolesFromProfile(disabledSuper)).toEqual([]);
    expect(rolesFromProfile(liveProfile({ is_disabled: null }))).toEqual([]);
    expect(rolesFromProfile(liveProfile({ role: "owner" }))).toEqual([]);
    expect(rolesFromProfile(liveProfile({ role: null }))).toEqual([]);
  });
});

describe("redirect and message helpers", () => {
  it("only honours same-origin application paths after sign-in", () => {
    expect(safeRedirectTarget("/admin?tab=users")).toBe("/admin?tab=users");
    expect(safeRedirectTarget(undefined)).toBe("/dashboard");
    expect(safeRedirectTarget("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectTarget("//evil.example")).toBe("/dashboard");
    expect(safeRedirectTarget("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectTarget("javascript:alert(1)")).toBe("/dashboard");
    expect(safeRedirectTarget("/auth")).toBe("/dashboard");
  });

  it("gives friendly sign-in errors without exposing provider text", () => {
    expect(signInErrorMessage({ code: "invalid_credentials", status: 400 })).toBe(
      "Incorrect email or password.",
    );
    expect(signInErrorMessage({ status: 429 })).toMatch(/too many/i);
    expect(signInErrorMessage({ status: 500 })).toBe("Could not sign you in. Please try again.");
  });

  it("validates replacement passwords", () => {
    expect(passwordProblem("short", "short")).toMatch(/at least/);
    expect(passwordProblem("long-enough-1", "different-1")).toMatch(/do not match/);
    expect(passwordProblem("long-enough-1", "long-enough-1")).toBeNull();
  });
});

describe("authenticated layout", () => {
  beforeEach(() => {
    auth.getUser.mockReset();
    auth.signOut.mockClear();
    auth.profile = { data: null, error: null };
  });

  async function enter() {
    const { Route } = await import("@/routes/_authenticated/route");
    const beforeLoad = Route.options.beforeLoad as unknown as (args: unknown) => Promise<void>;
    return beforeLoad({
      context: { queryClient: new QueryClient() },
      location: { href: "/admin" },
    });
  }

  it("denies unauthenticated visitors", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(enter()).rejects.toMatchObject({ options: { to: "/auth" } });
  });

  it("signs out and denies disabled accounts", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.profile = { data: liveProfile({ is_disabled: true }), error: null };
    await expect(enter()).rejects.toMatchObject({ options: { to: "/auth" } });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("fails closed when the profile is missing", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.profile = { data: null, error: null };
    await expect(enter()).rejects.toMatchObject({ options: { to: "/auth" } });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("reports lookup failures instead of treating them as no role", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.profile = { data: null, error: { message: "boom" } };
    await expect(enter()).rejects.toThrow(/could not load your account/i);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("admits an active account", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.profile = { data: liveProfile(), error: null };
    await expect(enter()).resolves.toBeUndefined();
  });
});

describe("role route guards", () => {
  function clientWithRoles(roles: string[]) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["me"], { user: {}, profile: {}, roles, primary: roles[0] ?? null });
    return { queryClient };
  }

  it("keeps students out of faculty, admin and super admin areas", async () => {
    const context = clientWithRoles(["student"]);
    for (const allowed of [["faculty"], ["admin"], ["super_admin"]] as const) {
      await expect(roleGuard([...allowed])({ context })).rejects.toMatchObject({
        options: { to: "/dashboard" },
      });
    }
  });

  it("keeps admins out of the super admin area", async () => {
    await expect(
      roleGuard(["super_admin"])({ context: clientWithRoles(["admin"]) }),
    ).rejects.toMatchObject({ options: { to: "/dashboard" } });
  });

  it("lets a matching role through", async () => {
    await expect(
      roleGuard(["admin"])({ context: clientWithRoles(["admin"]) }),
    ).resolves.toBeUndefined();
  });
});

describe("server-side permission checks", () => {
  it("rejects an admin impersonating a super admin", async () => {
    const admin = fakeClient(liveProfile({ role: "admin" }));
    await expect(assertSuperAdmin(admin, "u1")).rejects.toThrow(/super admin/i);
  });

  it("ignores a super admin flag on a non-admin row", async () => {
    for (const role of ["student", "faculty"]) {
      const client = fakeClient(liveProfile({ role, is_super_admin: true }));
      await expect(assertSuperAdmin(client, "u1")).rejects.toThrow();
    }
  });

  it("rejects students and faculty for institute admin operations", async () => {
    for (const role of ["student", "faculty"]) {
      await expect(assertInstituteAdmin(fakeClient(liveProfile({ role })), "u1")).rejects.toThrow(
        /admin account/i,
      );
    }
  });

  it("rejects disabled privileged accounts", async () => {
    const disabled = fakeClient(
      liveProfile({ role: "admin", is_super_admin: true, is_disabled: true }),
    );
    await expect(assertSuperAdmin(disabled, "u1")).rejects.toThrow();
    await expect(assertInstituteAdmin(disabled, "u1")).rejects.toThrow();
  });

  it("denies when the profile is missing and reports read failures", async () => {
    await expect(assertSuperAdmin(fakeClient(null), "u1")).rejects.toThrow();
    await expect(assertSuperAdmin(fakeClient(null, true), "u1")).rejects.toThrow(
      /could not load your account/i,
    );
  });

  it("allows an active matching account", async () => {
    const superAdmin = fakeClient(liveProfile({ role: "admin", is_super_admin: true }));
    await expect(assertSuperAdmin(superAdmin, "u1")).resolves.toEqual({
      id: "u1",
      email: "user@example.com",
    });
    await expect(
      assertInstituteAdmin(fakeClient(liveProfile({ role: "admin" })), "u1"),
    ).resolves.toBeUndefined();
  });

  it("requires an institute for institute admin operations", async () => {
    const noInstitute = fakeClient(liveProfile({ role: "admin", institute_id: null }));
    await expect(assertInstituteAdmin(noInstitute, "u1")).rejects.toThrow(/institute/i);
  });
});

describe("service-role boundary", () => {
  const srcDir = path.resolve(__dirname, "..");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  const clientFacing = sourceFiles(srcDir).filter((file) => !/\.server\.ts$/.test(file));

  it("keeps the service-role key out of every module that can ship to the browser", () => {
    for (const file of clientFacing) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/SERVICE_ROLE/);
    }
  });

  it("only loads the privileged client lazily from server-only modules", () => {
    for (const file of clientFacing) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["'][^"']*client\.server["']/);
    }
  });

  it("never exposes a service-role variable through the VITE_ prefix", () => {
    for (const file of sourceFiles(srcDir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/VITE_[A-Z_]*SERVICE/);
    }
  });
});
