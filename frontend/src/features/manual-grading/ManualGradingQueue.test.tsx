import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ManualGradingQueue from "./ManualGradingQueue";
import { useDemoSession } from "@/features/auth/AuthProvider";
import {
  getGradingPermissions,
  getPendingManualResponses,
} from "@/lib/manual-grading-api";
import type {
  ManualGradeQueueResponse,
} from "@/types/exam-api.types";

const { mockHandleError } = vi.hoisted(() => ({
  mockHandleError: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: vi.fn(),
}));

vi.mock("@/lib/manual-grading-api", () => ({
  getGradingPermissions: vi.fn(),
  getPendingManualResponses: vi.fn(),
}));

const queue: ManualGradeQueueResponse = {
  count: 2,
  items: [
    {
      attempt_id: "11111111-1111-4111-8111-111111111111",
      question_version_id: "22222222-2222-4222-8222-222222222222",
      response_type: "short_answer",
      learner_email: "learner@example.com",
      learner_name: "Test Learner",
      question_preview: "Explain the difference.",
      submitted_at: "2026-11-26T10:00:00Z",
      max_points: 2,
    },
    {
      attempt_id: "33333333-3333-4333-8333-333333333333",
      question_version_id: "44444444-4444-4444-8444-444444444444",
      response_type: "essay",
      learner_email: null,
      learner_name: null,
      question_preview: "Write an essay.",
      submitted_at: null,
      max_points: 5,
    },
  ],
};

function setSession(role: "learner" | "contributor" | "administrator") {
  vi.mocked(useDemoSession).mockReturnValue({
    token: "token",
    role,
    ready: true,
    handleError: mockHandleError,
  } as ReturnType<typeof useDemoSession>);
}

describe("ManualGradingQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession("contributor");
    vi.mocked(getGradingPermissions).mockResolvedValue({
      short_answer: true,
      essay: false,
    });
    vi.mocked(getPendingManualResponses).mockResolvedValue(queue);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows pending responses only to reviewers", async () => {
    render(<ManualGradingQueue />);

    expect(
      await screen.findByText("Explain the difference."),
    ).toBeTruthy();
    expect(screen.getByText("Test Learner")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Review response" })[0]
        .getAttribute("href"),
    ).toBe(
      "/admin/manual-grading/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222",
    );

    expect(getPendingManualResponses).toHaveBeenCalledWith(
      "token",
      undefined,
    );
  });

  it("disables filters for response types the reviewer cannot grade", async () => {
    render(<ManualGradingQueue />);
    await screen.findByText("Explain the difference.");

    expect(
      screen.getByRole("button", { name: "Short answers" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Essays" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("refetches with the selected response type", async () => {
    vi.mocked(getGradingPermissions).mockResolvedValue({
      short_answer: true,
      essay: true,
    });
    render(<ManualGradingQueue />);
    await screen.findByText("Explain the difference.");

    await userEvent.click(
      screen.getByRole("button", { name: "Essays" }),
    );

    await waitFor(() => {
      expect(getPendingManualResponses).toHaveBeenLastCalledWith(
        "token",
        "essay",
      );
    });
  });

  it("blocks learners before fetching grading data", () => {
    setSession("learner");
    render(<ManualGradingQueue />);

    expect(
      screen.getByText(
        "Only administrators and contributors can review written responses.",
      ),
    ).toBeTruthy();
    expect(getGradingPermissions).not.toHaveBeenCalled();
  });
});
