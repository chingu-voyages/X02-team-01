import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt, QuestionFeedback } from "@/types/exam-api.types";
import type { FinalExamSubmissionResponse } from "@/types/exam-submission.types";
import { useExamAttempt } from "./useExamAttempt";

const { handleError, replace } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ ready: true, token: "test-token", handleError }),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("@/lib/exam-submission", () => ({
  submitExam: vi.fn(),
}));

const attemptId = "attempt-1";

function makeAttempt(): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "cert-1",
    status: "in_progress",
    question_count: 3,
    current_position: 1,
    questions: [1, 2, 3].map((position) => ({
      id: `question-${position}`,
      position,
      question_text: `Question ${position}`,
      question_type: position === 2 ? "short_answer" : "multiple_choice",
      allows_multiple_answers: position === 3,
      difficulty: "easy",
      images: [],
      options: position === 2 ? [] : [
        { id: `option-${position}-a`, position: 1, option_text: "Choice A" },
        { id: `option-${position}-b`, position: 2, option_text: "Choice B" },
      ],
    })),
  };
}

async function loadAttempt() {
  const hook = renderHook(() => useExamAttempt(attemptId));
  await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
  return hook;
}

describe("useExamAttempt direct question navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getExam).mockResolvedValue(makeAttempt());
  });

  afterEach(cleanup);

  it("jumps directly without submitting or starting another attempt", async () => {
    const { result } = await loadAttempt();

    act(() => expect(result.current.goToQuestion(2)).toBe(true));
    expect(result.current.currentQuestion?.id).toBe("question-3");
    expect(result.current.currentQuestionIndex).toBe(2);
    expect(result.current.submittedCount).toBe(0);

    act(() => expect(result.current.goToQuestion(0)).toBe(true));
    expect(result.current.currentQuestion?.id).toBe("question-1");
    expect(getExam).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("retains unsubmitted single-choice, text and multiple-choice answers", async () => {
    const { result } = await loadAttempt();

    act(() => result.current.handleSelect("option-1-a"));
    act(() => { result.current.goToQuestion(1); });
    act(() => result.current.handleTextChange("My draft answer"));
    act(() => { result.current.goToQuestion(2); });
    act(() => result.current.handleSelect("option-3-a"));
    act(() => result.current.handleSelect("option-3-b"));

    act(() => { result.current.goToQuestion(0); });
    expect(result.current.currentSelected).toEqual(["option-1-a"]);
    expect(result.current.isSubmitted).toBe(false);

    act(() => { result.current.goToQuestion(1); });
    expect(result.current.textValue).toBe("My draft answer");
    expect(result.current.isSubmitted).toBe(false);

    act(() => { result.current.goToQuestion(2); });
    expect(result.current.currentSelected).toEqual(["option-3-a", "option-3-b"]);
    expect(result.current.submittedCount).toBe(0);
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("rejects invalid indices and leaves the current question unchanged", async () => {
    const { result } = await loadAttempt();
    act(() => { result.current.goToQuestion(1); });

    for (const index of [-1, 3, 0.5, NaN, Infinity]) {
      act(() => expect(result.current.goToQuestion(index)).toBe(false));
      expect(result.current.currentQuestionIndex).toBe(1);
    }
    act(() => expect(result.current.goToQuestion(1)).toBe(true));
  });

  it("preserves submitted answers and does not reveal deferred feedback", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: "question-1",
      is_submitted: true,
      feedback_released: false,
    });
    const { result } = await loadAttempt();

    act(() => result.current.handleSelect("option-1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(result.current.isSubmitted).toBe(true);

    act(() => { result.current.goToQuestion(2); });
    expect(result.current.currentFeedback).toBeUndefined();
    expect(result.current.isSubmitted).toBe(false);

    act(() => { result.current.goToQuestion(0); });
    expect(result.current.isSubmitted).toBe(true);
    expect(result.current.currentFeedback).toEqual({
      feedback_released: false,
      is_correct: null,
      correct_option_ids: [],
      explanation: null,
    });
    act(() => result.current.handleSelect("option-1-b"));
    act(() => result.current.handleSubmit());
    expect(result.current.currentSelected).toEqual(["option-1-a"]);
    expect(result.current.submittedCount).toBe(1);
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("preserves released immediate feedback when revisiting an answer", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: "question-1",
      is_submitted: true,
      feedback_released: true,
      is_correct: true,
      correct_option_ids: ["option-1-a"],
      explanation: "Released feedback",
    });
    const { result } = await loadAttempt();
    act(() => result.current.handleSelect("option-1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.currentFeedback).toBeUndefined();
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.currentFeedback).toMatchObject({
      feedback_released: true,
      is_correct: true,
      correct_option_ids: ["option-1-a"],
      explanation: "Released feedback",
    });
  });

  it("clears a question-specific submission error only when leaving it", async () => {
    const { result } = await loadAttempt();
    act(() => result.current.handleSubmit());
    expect(result.current.submitError).toBe("Choose an answer before submitting.");
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.submitError).not.toBe("");
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.submitError).toBe("");
  });

  it("blocks navigation while an answer is being submitted", async () => {
    let resolveAnswer!: (feedback: QuestionFeedback) => void;
    vi.mocked(submitAnswer).mockImplementation(
      () => new Promise((resolve) => { resolveAnswer = resolve; }),
    );
    const { result } = await loadAttempt();
    act(() => result.current.handleSelect("option-1-a"));
    act(() => result.current.handleSubmit());
    expect(result.current.isSubmitting).toBe(true);
    act(() => expect(result.current.goToQuestion(2)).toBe(false));
    expect(result.current.currentQuestionIndex).toBe(0);

    await act(async () => resolveAnswer({
      question_version_id: "question-1",
      is_submitted: true,
      feedback_released: false,
    }));
    expect(result.current.isSubmitting).toBe(false);
    act(() => expect(result.current.goToQuestion(2)).toBe(true));
  });

  it("blocks navigation while the exam is being finalized", async () => {
    const data = makeAttempt();
    for (const question of data.questions) {
      question.response = {
        question_version_id: question.id,
        is_submitted: true,
        answered_at: "2026-11-23T00:00:00Z",
        selected_option_ids: question.question_type === "short_answer"
          ? null : [question.options[0].id],
        text_response: question.question_type === "short_answer" ? "Answer" : null,
      };
    }
    vi.mocked(getExam).mockResolvedValue(data);
    let resolveFinish!: (response: FinalExamSubmissionResponse) => void;
    vi.mocked(submitExam).mockImplementation(
      () => new Promise((resolve) => { resolveFinish = resolve; }),
    );
    const { result } = await loadAttempt();
    act(() => { void result.current.handleFinish(); });
    expect(result.current.isFinishing).toBe(true);
    act(() => expect(result.current.goToQuestion(2)).toBe(false));
    expect(result.current.currentQuestionIndex).toBe(0);
    await act(async () => resolveFinish({
      attempt_id: attemptId,
      status: "submitted",
      question_count: 3,
      answered_count: 3,
      unanswered_count: 0,
      submitted_at: "2026-11-23T00:00:00Z",
      results_url: `/api/v1/exams/${attemptId}/results`,
    }));
    expect(replace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
  });
});
