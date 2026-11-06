import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import ExamCard from "./ExamCard";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { ApiError } from "@/lib/api-client";
import type { FinalExamSubmissionResponse } from "@/types/exam-submission.types";
import type { ExamAttempt } from "@/types/exam-api.types";

const { mockHandleError, mockReplace } = vi.hoisted(() => ({
  mockHandleError: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("@/lib/exam-submission", () => ({
  submitExam: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "test-token",
    ready: true,
    handleError: mockHandleError,
  }),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/questions/OptionItem", () => ({
  default: ({
    option,
    isSelected,
    isSubmitted,
    feedbackReleased,
    onSelect,
  }: {
    option: string;
    isSelected: boolean;
    isSubmitted: boolean;
    feedbackReleased: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      data-testid={`option-${option}`}
      data-feedback-released={String(feedbackReleased)}
      aria-pressed={isSelected}
      disabled={isSubmitted}
      onClick={onSelect}
    >
      {option}
    </button>
  ),
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionA = "33333333-3333-4333-8333-333333333333";
const optionB = "44444444-4444-4444-8444-444444444444";
const otherQuestionId = "66666666-6666-4666-8666-666666666666";

const submissionResponse: FinalExamSubmissionResponse = {
  attempt_id: attemptId,
  status: "submitted",
  question_count: 1,
  answered_count: 1,
  unanswered_count: 0,
  submitted_at: "2026-11-05T20:00:00Z",
  results_url: `/api/v1/exams/${attemptId}/results`,
};

function storedResponse() {
  return {
    question_version_id: questionId,
    selected_option_ids: [optionA],
    text_response: null,
    is_submitted: true,
    answered_at: "2026-11-05T12:00:00Z",
    is_correct: false,
  };
}

function attempt(response?: ReturnType<typeof storedResponse>): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress" as "in_progress" | "submitted",
    current_position: 1,
    question_count: 1,
    questions: [
      {
        id: questionId,
        position: 1,
        question_text: "Select the correct answer",
        question_type: "multiple_choice" as const,
        allows_multiple_answers: false,
        difficulty: "easy" as const,
        images: [],
        options: [
          { id: optionA, position: 1, option_text: "Choice A" },
          { id: optionB, position: 2, option_text: "Choice B" },
        ],
        ...(response ? { response } : {}),
      },
    ],
  };
}

async function selectAndSubmit() {
  const user = userEvent.setup();
  await screen.findByText("Select the correct answer");
  await user.click(screen.getByRole("button", { name: "Choice A" }));
  await user.click(screen.getByRole("button", { name: "Submit answer" }));
  await waitFor(() => {
    expect(screen.getByTestId("option-Choice A")).toBeDisabled();
  });
}

async function loadStoredAnswer() {
  vi.mocked(getExam).mockResolvedValue(attempt(storedResponse()));
  render(<ExamCard attemptId={attemptId} />);
  return screen.findByRole("button", { name: "Finish Exam" });
}

describe("ExamCard feedback and final submission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getExam).mockResolvedValue(attempt());
  });

  afterEach(() => {
    cleanup();
  });

  it("displays released immediate feedback", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: true,
      is_correct: false,
      correct_option_ids: [optionB],
    });

    render(<ExamCard attemptId={attemptId} />);
    await selectAndSubmit();

    expect(screen.getByTestId("option-Choice A").getAttribute("data-feedback-released")).toBe("true");
    expect(screen.getByText("Incorrect answer.")).toBeTruthy();
  });

  it("does not reveal correctness in deferred mode", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: false,
    });

    render(<ExamCard attemptId={attemptId} />);
    await selectAndSubmit();

    expect(screen.getByTestId("option-Choice A").getAttribute("data-feedback-released")).toBe("false");
    expect(screen.queryByText("Incorrect answer.")).toBeNull();
  });

  it("restores locked answers without inventing option coloring", async () => {
    await loadStoredAnswer();
    const selected = screen.getByTestId("option-Choice A");
    expect(selected).toBeDisabled();
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.getAttribute("data-feedback-released")).toBe("false");
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("does not color options without correct-option IDs", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: true,
      is_correct: false,
    });

    render(<ExamCard attemptId={attemptId} />);
    await selectAndSubmit();

    expect(screen.getByTestId("option-Choice A").getAttribute("data-feedback-released")).toBe("false");
  });

  it("finalizes a completed exam and navigates to results", async () => {
    vi.mocked(submitExam).mockResolvedValue(submissionResponse);
    const user = userEvent.setup();
    await loadStoredAnswer();

    await user.click(screen.getByRole("button", { name: "Finish Exam" }));

    await waitFor(() => {
      expect(submitExam).toHaveBeenCalledTimes(1);
      expect(submitExam).toHaveBeenCalledWith(attemptId, "test-token");
      expect(mockReplace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
    });
  });

  it("prevents duplicate requests while the final submission is pending", async () => {
    let resolveSubmit!: (value: FinalExamSubmissionResponse) => void;
    vi.mocked(submitExam).mockImplementation(
      () => new Promise((resolve) => { resolveSubmit = resolve; }),
    );

    const user = userEvent.setup();
    await loadStoredAnswer();
    await user.click(screen.getByRole("button", { name: "Finish Exam" }));

    const finishingButton = screen.getByRole("button", { name: "Finishing exam..." });
    expect(finishingButton).toBeDisabled();
    await user.click(finishingButton);
    expect(submitExam).toHaveBeenCalledTimes(1);

    await act(async () => { resolveSubmit(submissionResponse); });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
    });
  });

  it("does not finish if an earlier question is unanswered", async () => {
    const data = attempt();
    data.questions.push({
      ...data.questions[0],
      id: otherQuestionId,
      position: 2,
      question_text: "Second question",
      response: {
        ...storedResponse(),
        question_version_id: otherQuestionId,
      },
    });
    data.question_count = 2;
    data.current_position = 2;
    vi.mocked(getExam).mockResolvedValue(data);

    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByText("Second question");

    expect(screen.queryByRole("button", { name: "Finish Exam" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review unanswered questions" }));
    expect(screen.getByText("Select the correct answer")).toBeTruthy();
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("clears the session when final submission returns 401", async () => {
    vi.mocked(submitExam).mockRejectedValue(new ApiError(401, "Expired"));
    const user = userEvent.setup();
    await loadStoredAnswer();
    await user.click(screen.getByRole("button", { name: "Finish Exam" }));

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401 }),
      );
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("recovers when the server says an attempt was already submitted", async () => {
    const saved = attempt(storedResponse());
    vi.mocked(getExam)
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ ...saved, status: "submitted" });
    vi.mocked(submitExam).mockRejectedValue(new ApiError(409, "Already submitted"));

    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await user.click(await screen.findByRole("button", { name: "Finish Exam" }));

    await waitFor(() => {
      expect(getExam).toHaveBeenCalledTimes(2);
      expect(mockReplace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
    });
  });

  it("displays a retryable error when final submission fails", async () => {
    vi.mocked(submitExam).mockRejectedValueOnce(new ApiError(500, "Server error"))
      .mockResolvedValueOnce(submissionResponse);

    const user = userEvent.setup();
    await loadStoredAnswer();
    await user.click(screen.getByRole("button", { name: "Finish Exam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");

    await user.click(screen.getByRole("button", { name: "Finish Exam" }));
    await waitFor(() => {
      expect(submitExam).toHaveBeenCalledTimes(2);
      expect(mockReplace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
    });
  });
});
