import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CategoriesPage from "./page";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";
import { ApiError } from "@/lib/api-client";

const { mockPush, mockHandleError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    token: "demo-token",
    ready: true,
    setToken: vi.fn(),
    logout: vi.fn(),
  }),
  useDemoSession: () => ({
    token: "demo-token",
    ready: true,
    handleError: mockHandleError,
  }),
}));
vi.mock("@/lib/practice-exam-api", () => ({
  getPublishedPracticeExams: vi.fn(),
  startPublishedPracticeExam: vi.fn(),
}));

const exam = {
  id: "11111111-1111-4111-8111-111111111111",
  certification_id: "22222222-2222-4222-8222-222222222222",
  certification_name: "Computer Science",
  category_id: "66666666-6666-4666-8666-666666666666",
  category_name: "Fundamentals",
  name: "Science Practice",
  question_count: 3,
  available_question_count: 10,
};
const otherExam = {
  ...exam,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Advanced Science Practice",
};
const existingAttemptId = "77777777-7777-4777-8777-777777777777";

async function startSelectedExam() {
  const user = userEvent.setup();
  render(<CategoriesPage />);
  await user.click(
    await screen.findByRole("button", { name: "View exam — Science Practice" }),
  );
  await user.click(screen.getByRole("button", { name: "Start Exam" }));
  return user;
}

describe("Published learner exam selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPublishedPracticeExams).mockResolvedValue([exam]);
    vi.mocked(startPublishedPracticeExam).mockResolvedValue({
      attempt_id: "33333333-3333-4333-8333-333333333333",
      certification_id: exam.certification_id,
      status: "in_progress",
      question_count: 3,
      questions: [],
    });
  });

  afterEach(() => cleanup());

  it("uses the published catalog, not the category question bank", async () => {
    render(<CategoriesPage />);
    expect(await screen.findByText("Science Practice")).toBeTruthy();
    expect(getPublishedPracticeExams).toHaveBeenCalledWith("demo-token");
    expect(screen.getByText("3 questions per exam")).toBeTruthy();
  });

  it("has no learner-editable question count", async () => {
    render(<CategoriesPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "View exam — Science Practice" }),
    );
    expect(screen.getByText("Exam length is set by an administrator.")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("starts the configured exam then navigates", async () => {
    await startSelectedExam();
    await waitFor(() => {
      expect(startPublishedPracticeExam).toHaveBeenCalledWith("demo-token", exam);
      expect(mockPush).toHaveBeenCalledWith(
        "/exams/33333333-3333-4333-8333-333333333333",
      );
    });
  });

  it("shows an empty state when no exams are published", async () => {
    vi.mocked(getPublishedPracticeExams).mockResolvedValue([]);
    render(<CategoriesPage />);
    expect(
      await screen.findByText("No published practice exams are currently available."),
    ).toBeTruthy();
  });

  it("handles expiration using the shared session provider", async () => {
    vi.mocked(getPublishedPracticeExams).mockRejectedValue(
      new ApiError(401, "Session expired"),
    );
    render(<CategoriesPage />);
    await waitFor(() => expect(mockHandleError).toHaveBeenCalled());
  });

  it("shows catalog failures with a retry option", async () => {
    vi.mocked(getPublishedPracticeExams).mockRejectedValueOnce(
      new ApiError(503, "Unavailable"),
    );
    const user = userEvent.setup();
    render(<CategoriesPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Retry loading practice exams" }),
    );
    expect(await screen.findByText("Science Practice")).toBeTruthy();
  });

  it("offers to resume an existing started attempt", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: existingAttemptId,
      }),
    );
    const user = await startSelectedExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue existing exam" }));
    expect(mockPush).toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
  });

  it("does not navigate to unsafe resume IDs", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: "//unsafe.example/path",
      }),
    );
    await startSelectedExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
  });

  it("reports a stale or unpublished exam without resume controls", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", { code: "PRACTICE_EXAM_UNAVAILABLE" }),
    );
    await startSelectedExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload available exams" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
  });

  it("clears a recovered attempt when switching to another exam", async () => {
    vi.mocked(getPublishedPracticeExams).mockResolvedValue([exam, otherExam]);
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: existingAttemptId,
      }),
    );
    const user = await startSelectedExam();
    expect(await screen.findByRole("button", { name: "Continue existing exam" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: /View exam.*Advanced Science Practice/i }),
    );
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
  });
});
