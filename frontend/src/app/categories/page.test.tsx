import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CategoriesPage from "./page";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";
import { ApiError } from "@/lib/api-client";
import type { ExamCreatedResponse } from "@/types/exam-api.types";

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
const otherAttemptId = "88888888-8888-4888-8888-888888888888";

function conflict(attemptId: string) {
  return new ApiError(409, "Conflict", {
    code: "ATTEMPT_IN_PROGRESS",
    attempt_id: attemptId,
  });
}

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
    vi.resetAllMocks();
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

  it("offers to resume only the selected exam's existing attempt", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      conflict(existingAttemptId),
    );
    const user = await startSelectedExam();
    expect(
      await screen.findByText("You have an unfinished attempt for Science Practice."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Continue Science Practice" })).toBeTruthy();
    expect(screen.getByText("IN PROGRESS")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Exam" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload available exams" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue existing exam" }));
    expect(mockPush).toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
    expect(startPublishedPracticeExam).toHaveBeenCalledTimes(1);
  });

  it("does not navigate to unsafe resume IDs", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(
      conflict("//unsafe.example/path"),
    );
    await startSelectedExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
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
      conflict(existingAttemptId),
    );
    const user = await startSelectedExam();
    expect(await screen.findByRole("button", { name: "Continue existing exam" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: /View exam.*Advanced Science Practice/i }),
    );
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Start Advanced Science Practice" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start Exam" }));
    await waitFor(() => {
      expect(startPublishedPracticeExam).toHaveBeenLastCalledWith("demo-token", otherExam);
      expect(mockPush).toHaveBeenCalledWith("/exams/33333333-3333-4333-8333-333333333333");
    });
    expect(mockPush).not.toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
  });

  it("keeps distinct resume IDs for exams with identical category and count", async () => {
    vi.mocked(getPublishedPracticeExams).mockResolvedValue([exam, otherExam]);
    vi.mocked(startPublishedPracticeExam)
      .mockRejectedValueOnce(conflict(existingAttemptId))
      .mockRejectedValueOnce(conflict(otherAttemptId))
      .mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startSelectedExam();
    expect(await screen.findByText("You have an unfinished attempt for Science Practice.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "View exam — Advanced Science Practice" }));
    await user.click(screen.getByRole("button", { name: "Start Exam" }));
    expect(await screen.findByText("You have an unfinished attempt for Advanced Science Practice.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue existing exam" }));
    expect(mockPush).toHaveBeenLastCalledWith(`/exams/${otherAttemptId}`);

    await user.click(screen.getByRole("button", { name: "View exam — Science Practice" }));
    await user.click(screen.getByRole("button", { name: "Start Exam" }));
    expect(await screen.findByText("You have an unfinished attempt for Science Practice.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue existing exam" }));
    expect(mockPush.mock.calls).toEqual([
      [`/exams/${otherAttemptId}`],
      [`/exams/${existingAttemptId}`],
    ]);
  });

  it("keeps the selection fixed while starting and restores it after a conflict", async () => {
    vi.mocked(getPublishedPracticeExams).mockResolvedValue([exam, otherExam]);
    let rejectStart!: (reason: unknown) => void;
    vi.mocked(startPublishedPracticeExam).mockImplementationOnce(
      () => new Promise<ExamCreatedResponse>((_resolve, reject) => {
        rejectStart = reject;
      }),
    );
    const user = await startSelectedExam();
    const otherCard = screen.getByRole<HTMLButtonElement>("button", { name: "View exam — Advanced Science Practice" });
    expect(otherCard.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "All exams" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Certification or topic" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Starting exam..." }).disabled).toBe(true);
    await user.click(otherCard);
    expect(screen.getByRole("heading", { name: "Start Science Practice" })).toBeTruthy();
    expect(startPublishedPracticeExam).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectStart(conflict(existingAttemptId));
    });
    expect(await screen.findByText("You have an unfinished attempt for Science Practice.")).toBeTruthy();
    expect(otherCard.disabled).toBe(false);
    await user.click(otherCard);
    expect(screen.getByRole("heading", { name: "Start Advanced Science Practice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not discard a resume link by reselecting the same exam", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startSelectedExam();
    await screen.findByRole("button", { name: "Continue existing exam" });
    await user.click(screen.getByRole("button", { name: "View exam — Science Practice" }));
    expect(screen.getByRole("button", { name: "Continue existing exam" })).toBeTruthy();
    expect(startPublishedPracticeExam).toHaveBeenCalledTimes(1);
  });

  it("clears a recovered attempt when the certification filter is reset", async () => {
    vi.mocked(startPublishedPracticeExam).mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startSelectedExam();
    await screen.findByRole("button", { name: "Continue existing exam" });
    await user.click(screen.getByRole("button", { name: "All exams" }));
    expect(screen.queryByRole("button", { name: "Continue existing exam" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Continue Science Practice" })).toBeNull();
  });
});
