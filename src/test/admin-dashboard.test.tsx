import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import {
  adminOverview,
  adminUsers,
  adminActivity,
  adminCreateUser,
  adminUpdateUser,
} from "@/lib/admin.functions";
import {
  adminCreateUserSchema,
  adminEditUserSchema,
  adminUserFiltersSchema,
} from "@/lib/admin.contracts";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/lib/admin.functions", () => ({
  adminOverview: vi.fn(),
  adminUsers: vi.fn(),
  adminActivity: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUser: vi.fn(),
}));
vi.mock("@/lib/super-admin.functions", () => ({ dashboardActivity: vi.fn() }));
const ownerId = "10000000-0000-4000-8000-000000000001";
const studentId = "10000000-0000-4000-8000-000000000002";
const instituteId = "10000000-0000-4000-8000-000000000003";
const baseUser = {
  email: "student@example.test",
  full_name: "Demo Student",
  roll_number: "25PT001",
  institute_id: instituteId,
  institute_code: "PT",
  institute_name: "PT Campus",
  is_active: true,
  disabled_at: null,
  created_at: "2026-10-09T10:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(adminOverview).mockResolvedValue({
    institute: { id: instituteId, code: "PT", name: "PT Campus" },
    total: 2,
    active: 2,
    disabled: 0,
    unassigned: 0,
    roles: { student: 1, admin: 1 },
  });
  vi.mocked(adminUsers).mockResolvedValue({
    total: 2,
    items: [
      { ...baseUser, id: studentId, roles: ["student"] },
      {
        ...baseUser,
        id: ownerId,
        full_name: "Demo Admin",
        email: "admin@example.test",
        roles: ["admin", "faculty"],
        is_active: false,
      },
    ],
  });
  vi.mocked(adminActivity).mockResolvedValue({ total: 0, items: [] });
  vi.mocked(adminUpdateUser).mockResolvedValue({ ok: true });
  vi.mocked(adminCreateUser).mockResolvedValue({ id: studentId });
});
afterEach(cleanup);
function dashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["me"], {
    user: { id: ownerId, email: "admin@example.test" },
    profile: { full_name: "Demo Admin", institutes: { code: "PT" } },
    roles: ["admin"],
    primary: "admin",
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminDashboard />
    </QueryClientProvider>,
  );
}
describe("institute admin dashboard", () => {
  it("opens the student directory with a fixed role and protects privileged accounts", async () => {
    dashboard();
    fireEvent.click(await screen.findByRole("button", { name: /1 Students Enrolled accounts/ }));
    expect(await screen.findByRole("heading", { name: "Student directory" })).toBeInTheDocument();
    await waitFor(() =>
      expect(adminUsers).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: "student" }),
      }),
    );
    expect(await screen.findByRole("button", { name: "Manage Demo Student" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage Demo Admin" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter role")).not.toBeInTheDocument();
  });
  it("creates faculty without accepting institute or privileged role selection", async () => {
    dashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Add faculty" }));
    const dialog = screen.getByRole("dialog");
    const role = within(dialog).getByLabelText("Role", { exact: true });
    expect(role).toHaveValue("faculty");
    expect(within(role).getAllByRole("option")).toHaveLength(2);
    expect(within(dialog).queryByLabelText("Institute")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Full name"), {
      target: { value: "New Faculty" },
    });
    fireEvent.change(within(dialog).getByLabelText("Email address"), {
      target: { value: "new@example.test" },
    });
    fireEvent.change(within(dialog).getByLabelText("Initial password"), {
      target: { value: "Test!Password123" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(adminCreateUser).toHaveBeenCalledWith({
        data: {
          full_name: "New Faculty",
          email: "new@example.test",
          password: "Test!Password123",
          roll_number: "",
          role: "faculty",
          is_active: true,
        },
      }),
    );
    expect(
      await screen.findByText("Account created. Share the credentials securely with the user."),
    ).toBeInTheDocument();
  });
  it("saves role and access edits and refreshes the directory", async () => {
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "All users" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage Demo Student" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Role", { exact: true }), {
      target: { value: "faculty" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(adminUpdateUser).toHaveBeenCalledWith({
        data: {
          user_id: studentId,
          full_name: "Demo Student",
          roll_number: "25PT001",
          role: "faculty",
          is_active: false,
        },
      }),
    );
    expect(await screen.findByText("Account details and access updated.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps failed edits open and reports the server error", async () => {
    vi.mocked(adminUpdateUser).mockRejectedValue(
      new Error("This account is outside your institute."),
    );
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "All users" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage Demo Student" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("outside your institute");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("activity filters issue scoped requests and reset the page", async () => {
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    fireEvent.change(await screen.findByLabelText("Filter activity type"), {
      target: { value: "user_deactivated" },
    });
    await waitFor(() =>
      expect(adminActivity).toHaveBeenCalledWith({
        data: { search: "", action: "user_deactivated", role: null, page: 1 },
      }),
    );
    expect(screen.getByRole("button", { name: "Export this page" })).toBeDisabled();
  });
});
describe("admin input boundaries", () => {
  it("rejects injected institute, actor, creation flags, and privileged roles", () => {
    const fields = {
      full_name: "Example",
      user_id: studentId,
      roll_number: "",
      role: "student",
      is_active: true,
    };
    for (const extra of [
      { institute_id: instituteId },
      { actor_id: ownerId },
      { p_create: true },
      { role: "admin" },
      { role: "super_admin" },
    ])
      expect(adminEditUserSchema.safeParse({ ...fields, ...extra }).success).toBe(false);
    expect(adminUserFiltersSchema.safeParse({ instituteId }).success).toBe(false);
    expect(
      adminCreateUserSchema.safeParse({
        ...fields,
        email: "new@example.test",
        password: "Test!Password123",
      }).success,
    ).toBe(false);
  });
});
