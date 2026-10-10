import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuperAdminDashboard } from "@/components/super-admin/SuperAdminDashboard";
import {
  dashboardOverview,
  dashboardUsers,
  dashboardActivity,
  dashboardUpdateUser,
} from "@/lib/super-admin.functions";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/lib/super-admin.functions", () => ({
  dashboardOverview: vi.fn(),
  dashboardUsers: vi.fn(),
  dashboardActivity: vi.fn(),
  dashboardCreateUser: vi.fn(),
  dashboardUpdateUser: vi.fn(),
  dashboardSaveInstitute: vi.fn(),
}));
const ownerId = "10000000-0000-4000-8000-000000000001";
const studentId = "10000000-0000-4000-8000-000000000002";
const instituteId = "10000000-0000-4000-8000-000000000003";
const baseUser = {
  email: "student@example.test",
  full_name: "Demo Student",
  roll_number: "25PT1A0501",
  institute_id: instituteId,
  institute_code: "PT",
  institute_name: "PT Campus",
  is_active: true,
  disabled_at: null,
  created_at: "2026-10-09T10:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(dashboardOverview).mockResolvedValue({
    total: 2,
    active: 2,
    disabled: 0,
    unassigned: 0,
    roles: { super_admin: 1, student: 1 },
    institutes: [
      {
        id: instituteId,
        code: "PT",
        name: "PT Campus",
        users: 1,
        active: 1,
        students: 1,
        faculty: 0,
        admins: 0,
      },
    ],
  });
  vi.mocked(dashboardUsers).mockResolvedValue({
    total: 2,
    items: [
      { ...baseUser, id: studentId, roles: ["student"] },
      {
        ...baseUser,
        id: ownerId,
        email: "owner@example.test",
        full_name: "Demo Owner",
        institute_id: null,
        institute_code: null,
        roles: ["super_admin"],
      },
    ],
  });
  vi.mocked(dashboardActivity).mockResolvedValue({ total: 0, items: [] });
  vi.mocked(dashboardUpdateUser).mockResolvedValue({ ok: true });
});
afterEach(cleanup);
function dashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["me"], {
    user: { id: ownerId, email: "owner@example.test" },
    profile: { full_name: "Demo Owner" },
    roles: ["super_admin"],
    primary: "super_admin",
  });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminDashboard />
    </QueryClientProvider>,
  );
}
describe("super admin dashboard workflows", () => {
  it("shows real summaries and opens institute-filtered users", async () => {
    dashboard();
    expect(await screen.findByText("PT Campus")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /PT Campus/ }));
    expect(await screen.findByRole("heading", { name: "User directory" })).toBeInTheDocument();
    await waitFor(() =>
      expect(dashboardUsers).toHaveBeenCalledWith({
        data: expect.objectContaining({ instituteId }),
      }),
    );
  });
  it("sends role and access edits and reports a successful save", async () => {
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage Demo Student" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Role", { exact: true }), {
      target: { value: "faculty" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(dashboardUpdateUser).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: studentId, role: "faculty", is_active: false }),
      }),
    );
    expect(await screen.findByText("User details and access updated.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("protects the signed-in owner's own role and access in the editor", async () => {
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage Demo Owner" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Role", { exact: true })).toBeDisabled();
    expect(within(dialog).getByLabelText("Institute", { exact: true })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox")).toBeDisabled();
  });
  it("keeps the editor open and shows server errors without reporting success", async () => {
    vi.mocked(dashboardUpdateUser).mockRejectedValue(new Error("Permission check failed."));
    dashboard();
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage Demo Student" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission check failed.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("User details and access updated.")).not.toBeInTheDocument();
  });
});
