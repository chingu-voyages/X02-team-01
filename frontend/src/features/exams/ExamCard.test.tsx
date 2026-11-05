import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import ExamCard from "./ExamCard";
import { getExam, submitAnswer } from "@/lib/exam-api";

const { mockHandleError } = vi.hoisted(() => ({
  mockHandleError: vi.fn(),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "test-token",
    ready: true,
    handleError: mockHandleError,
  }),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Inspect what feedback information reaches each option.
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

function attempt(response?: {
  question_version_id: string;
  selected_option_ids: string[] | null;
  text_response: string | null;
  is_submitted: boolean;
  answered_at: string;
  is_correct?: boolean;
}) {
  return {
    attempt_id: attemptId,
    certification_id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress" as const,
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

describe("ExamCard feedback disclosure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getExam).mockResolvedValue(attempt());
  });

  afterEach(() => {
    cleanup();
  });

  it("releases option feedback for immediate grading", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: true,
      is_correct: false,
      correct_option_ids: [optionB],
    });

    render(<ExamCard attemptId={attemptId} />);
    await selectAndSubmit();

    expect(
      screen.getByTestId("option-Choice A").getAttribute(
        "data-feedback-released",
      ),
    ).toBe("true");

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

    expect(
      screen.getByTestId("option-Choice A").getAttribute(
        "data-feedback-released",
      ),
    ).toBe("false");

    expect(screen.queryByText("Incorrect answer.")).toBeNull();
  });

  it("keeps restored answers locked without inventing option feedback", async () => {
    vi.mocked(getExam).mockResolvedValue(
      attempt({
        question_version_id: questionId,
        selected_option_ids: [optionA],
        text_response: null,
        is_submitted: true,
        answered_at: "2026-11-05T12:00:00Z",
        is_correct: false,
      }),
    );

    render(<ExamCard attemptId={attemptId} />);

    await screen.findByText("Select the correct answer");

    const selected = screen.getByTestId("option-Choice A");

    expect(selected).toBeDisabled();
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.getAttribute("data-feedback-released")).toBe(
      "false",
    );

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

    expect(
      screen.getByTestId("option-Choice A").getAttribute(
        "data-feedback-released",
      ),
    ).toBe("false");
  });
});
