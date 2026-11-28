import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdminOverviewPage from "@/features/admin/AdminOverviewPage";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getDashboardOverview } from "@/lib/admin-dashboard-api";

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: vi.fn(),
}));

vi.mock("@/lib/admin-dashboard-api", () => ({
  getDashboardOverview: vi.fn(),
}));

const mockHandleError = vi.fn();

const sampleOverview = {
  registered_learners: 12,
  completed_attempts: 34,
  participating_learners: 9,
  pending_question_reviews: 5,
  review_breakdown: { submitted: 3, in_review: 2 },
  attempts_by_exam: [
    { exam_id: "exam-1", title: "Scrum Master Practice", count: 20 },
    { exam_id: null, title: "Legacy (earlier exams)", count: 14 },
  ],
  filters: {},
  generated_at: "2026-01-01T00:00:00Z",
};

describe("AdminOverviewPage (JHEP-115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDemoSession).mockReturnValue({
      token: "admin-token",
      ready: true,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);
  });

  afterEach(cleanup);

  it("shows a loading state while the session resolves", () => {
    vi.mocked(useDemoSession).mockReturnValue({
      token: null,
      ready: false,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);

    render(<AdminOverviewPage />);

    expect(screen.getByRole("status").textContent).toBe(
      "Loading the dashboard...",
    );
    expect(getDashboardOverview).not.toHaveBeenCalled();
  });

  it("renders the four KPI cards, attention panel and attempts table", async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue(sampleOverview);

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Registered Learners")).toBeTruthy();
    });

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText("34").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(2);

    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByText("In review")).toBeTruthy();

    expect(screen.getAllByText("Scrum Master Practice").length).toBeGreaterThan(0);
    expect(screen.getByText("Legacy (earlier exams)")).toBeTruthy();

  });

  it("shows an access-denied state on 403", async () => {
    vi.mocked(getDashboardOverview).mockRejectedValue(
      new ApiError(403, "You do not have permission to perform this action."),
    );

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /You do not have permission to view the Administrator dashboard/,
        ),
      ).toBeTruthy();
    });
    expect(mockHandleError).not.toHaveBeenCalled();
  });

  it("delegates expired sessions to the auth handler", async () => {
    const authError = new ApiError(401, "Your session has expired.");
    vi.mocked(getDashboardOverview).mockRejectedValue(authError);

    render(<AdminOverviewPage />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(authError);
    });
  });

  it("shows an error state with retry for server failures", async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardOverview)
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce(sampleOverview);

    render(<AdminOverviewPage />);

    expect(
      await screen.findByText("Network failure"),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Registered Learners")).toBeTruthy();
    expect(getDashboardOverview).toHaveBeenCalledTimes(2);
  });

  it("sends the selected period filter", async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardOverview).mockResolvedValue(sampleOverview);

    render(<AdminOverviewPage />);

    await screen.findByText("Registered Learners");
    expect(getDashboardOverview).toHaveBeenCalledWith("admin-token", {
      period: "30",
      from: undefined,
      to: undefined,
      exam_id: undefined,
    });

    await user.selectOptions(
      screen.getByLabelText("Reporting period"),
      "7",
    );

    await waitFor(() => {
      expect(getDashboardOverview).toHaveBeenCalledWith("admin-token", {
        period: "7",
        from: undefined,
        to: undefined,
        exam_id: undefined,
      });
    });
  });

  it("sends custom inclusive dates when the period is custom", async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardOverview).mockResolvedValue(sampleOverview);

    render(<AdminOverviewPage />);

    await screen.findByText("Registered Learners");

    await user.selectOptions(
      screen.getByLabelText("Reporting period"),
      "custom",
    );

    await user.type(screen.getByLabelText("Period start date"), "2026-01-01");
    await user.type(screen.getByLabelText("Period end date"), "2026-01-31");

    await waitFor(() => {
      expect(getDashboardOverview).toHaveBeenCalledWith("admin-token", {
        period: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
        exam_id: undefined,
      });
    });
  });

  it("sends the exam filter when one exam is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardOverview).mockResolvedValue(sampleOverview);

    render(<AdminOverviewPage />);

    await screen.findByText("Registered Learners");

    await user.selectOptions(
      screen.getByLabelText("Exam filter"),
      "exam-1",
    );

    await waitFor(() => {
      expect(getDashboardOverview).toHaveBeenCalledWith("admin-token", {
        period: "30",
        from: undefined,
        to: undefined,
        exam_id: "exam-1",
      });
    });
  });

  it("renders all three management shortcuts", async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue(sampleOverview);

    render(<AdminOverviewPage />);

    await screen.findByText("Registered Learners");

    expect(screen.getByRole("link", { name: /Create Question/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Manage Exams/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Manage Users/ })).toBeTruthy();
  });
});
