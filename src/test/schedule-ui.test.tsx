import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScheduleView } from "@/components/learning/ScheduleView";
import { buildPlan } from "@/lib/schedule/plan";
import type { ScheduleItem } from "@/lib/schedule/types";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
afterEach(cleanup);
const item = (id: string, completed = false): ScheduleItem => ({
  id,
  kind: "sheet",
  title: id,
  topicId: "t",
  topicName: "Python",
  subTopic: "Basics",
  href: "/learn/t/" + id,
  minutes: 60,
  completed,
});
describe("schedule navigation", () => {
  it("navigates months and days and links the next incomplete item", () => {
    const plan = buildPlan([item("Read", true), item("Practice")], "2026-08-31", {
      dailyMinutes: 60,
    });
    render(<ScheduleView plan={plan} today="2026-08-31" />);
    expect(screen.getByRole("link", { name: "Continue learning: Practice" })).toHaveAttribute(
      "href",
      "/learn/t/Practice",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2026-09-01, study day 2" }));
    expect(screen.getByRole("heading", { name: "2026-09-01 · Day 2" })).toBeInTheDocument();
    expect(screen.getByText("0–60 planned minutes · Cheat Sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2026-09-06, no scheduled work" }));
    expect(screen.getByText(/No work is scheduled on this date/)).toBeInTheDocument();
  });
});
