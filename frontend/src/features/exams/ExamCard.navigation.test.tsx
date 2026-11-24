import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import ExamCard from "./ExamCard";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt } from "@/types/exam-api.types";

const { handleError, replace, logout } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "test-token", ready: true, handleError }),
  useAuth: () => ({ logout }),
}));
vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/questions/OptionItem", () => ({
  default: ({ option, isSelected, isSubmitted, onSelect }: {
    option: string;
    isSelected: boolean;
    isSubmitted: boolean;
    onSelect: () => void;
  }) => (
    <button type="button" aria-pressed={isSelected} disabled={isSubmitted} onClick={onSelect}>
      {option}
    </button>
  ),
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const thirdQuestionId = "44444444-4444-4444-8444-444444444444";

function attempt(): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress",
    current_position: 1,
    question_count: 3,
    questions: [
      {
        id: questionId,
        position: 1,
        question_text: "First question",
        question_type: "multiple_choice",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [{ id: optionId, position: 1, option_text: "First choice" }],
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        position: 2,
        question_text: "Second question",
        question_type: "short_answer",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [],
      },
      {
        id: thirdQuestionId,
        position: 3,
        question_text: "Third question",
        question_type: "multiple_choice",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [{ id: "77777777-7777-4777-8777-777777777777", position: 1, option_text: "Third choice" }],
      },
    ],
  };
}

function questionButton(number: number) {
  return within(screen.getByRole("navigation", { name: "Question navigation" }))
    .getByRole("button", { name: `Question ${number}` });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getExam).mockResolvedValue(attempt());
});
afterEach(cleanup);

describe("ExamCard numbered navigation", () => {
  it("jumps directly and retains unsubmitted option selections and short answers without API writes", async () => {
    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));

    await user.click(questionButton(3));
    expect(screen.getByRole("heading", { name: "Third question" })).toBeInTheDocument();
    expect(questionButton(3)).toHaveAttribute("aria-current", "step");
    await user.click(questionButton(2));
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "My draft answer");
    await user.click(questionButton(1));
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    await user.click(questionButton(2));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("My draft answer");

    expect(getExam).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("retains a locked submitted answer without revealing deferred feedback when revisited", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: false,
    });
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled());

    await user.click(questionButton(3));
    await user.click(questionButton(1));
    expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer.")).not.toBeInTheDocument();
    expect(screen.getByText("Submitted answers: 1 / 3")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("keeps released immediate feedback associated with its original question", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: true,
      is_correct: true,
      correct_option_ids: [optionId],
      explanation: "Feedback for question one.",
    });
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await screen.findByText("Correct answer.");

    await user.click(questionButton(3));
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument();
    expect(screen.queryByText("Feedback for question one.")).not.toBeInTheDocument();
    await user.click(questionButton(1));
    expect(screen.getByText("Correct answer.")).toBeInTheDocument();
    expect(screen.getByText("Feedback for question one.")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});
