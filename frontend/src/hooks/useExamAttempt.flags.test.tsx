import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt, QuestionFlagSaved } from "@/types/exam-api.types";
import { useExamAttempt } from "./useExamAttempt";

const { handleError, replace } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ ready: true, token: "test-token", handleError }),
}));
vi.mock("@/lib/exam-recovery-api", () => ({
  saveExamDraft: () => Promise.resolve(undefined),
  saveExamPosition: () => Promise.resolve(undefined),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  setQuestionFlag: vi.fn(),
  submitAnswer: vi.fn(),
}));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));

const attemptId = "attempt-1";
const firstId = "question-1";
const secondId = "question-2";

function makeAttempt(id = attemptId): ExamAttempt {
  return {
    attempt_id: id,
    certification_id: "cert-1",
    status: "in_progress",
    question_count: 2,
    current_position: 1,
    questions: [firstId, secondId].map((questionId, index) => ({
      id: questionId,
      position: index + 1,
      question_text: `Question ${index + 1}`,
      question_type: index === 0 ? "multiple_choice" : "short_answer",
      allows_multiple_answers: false,
      difficulty: "easy",
      images: [],
      options: index === 0 ? [
        { id: "option-a", position: 1, option_text: "A" },
        { id: "option-b", position: 2, option_text: "B" },
      ] : [],
      flagged_for_review: false,
    })),
  };
}

function confirmation(flagged = true, id = firstId, examId = attemptId): QuestionFlagSaved {
  return {
    attempt_id: examId,
    question_version_id: id,
    flagged_for_review: flagged,
  };
}

async function loadAttempt() {
  const hook = renderHook(({ id }) => useExamAttempt(id), {
    initialProps: { id: attemptId },
  });
  await waitFor(() => expect(hook.result.current.canToggleFlag).toBe(true));
  return hook;
}

describe("JHEP-104 useExamAttempt review flags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getExam).mockResolvedValue(makeAttempt());
    vi.mocked(setQuestionFlag).mockImplementation(async (examId, id, flagged) =>
      confirmation(flagged, id, examId),
    );
  });
  afterEach(cleanup);

  it("restores saved flags and treats a missing flag as false", async () => {
    const data = makeAttempt();
    data.questions[0].flagged_for_review = true;
    delete data.questions[1].flagged_for_review;
    vi.mocked(getExam).mockResolvedValue(data);
    const { result } = await loadAttempt();
    expect(result.current.isFlagged).toBe(true);
    expect(result.current.flaggedQuestionIds).toEqual([firstId]);
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.isFlagged).toBe(false);
    expect(setQuestionFlag).not.toHaveBeenCalled();
  });

  it("flags and unflags without submitting an unanswered question", async () => {
    const { result } = await loadAttempt();
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.isFlagged).toBe(true);
    expect(result.current.flaggedQuestionIds).toEqual([firstId]);
    expect(result.current.submittedCount).toBe(0);
    expect(setQuestionFlag).toHaveBeenLastCalledWith(attemptId, firstId, true, "test-token");
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.flaggedQuestionIds).toEqual([]);
    expect(setQuestionFlag).toHaveBeenLastCalledWith(attemptId, firstId, false, "test-token");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("retains draft selections and written answers across navigation", async () => {
    const { result } = await loadAttempt();
    act(() => result.current.handleSelect("option-a"));
    await act(async () => { await result.current.handleToggleFlag(); });
    act(() => { result.current.goToQuestion(1); });
    act(() => result.current.handleTextChange("My draft"));
    await act(async () => { await result.current.handleToggleFlag(); });
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.currentSelected).toEqual(["option-a"]);
    expect(result.current.isFlagged).toBe(true);
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.textValue).toBe("My draft");
    expect(result.current.isFlagged).toBe(true);
    expect(result.current.flaggedQuestionIds).toEqual([firstId, secondId]);
    expect(result.current.submittedCount).toBe(0);
    expect(getExam).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("allows flags on submitted answers without unlocking them or releasing feedback", async () => {
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: firstId,
      is_submitted: true,
      feedback_released: false,
    });
    const { result } = await loadAttempt();
    act(() => result.current.handleSelect("option-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(result.current.isSubmitted).toBe(true);
    const feedback = result.current.currentFeedback;
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.isFlagged).toBe(true);
    act(() => result.current.handleSelect("option-b"));
    expect(result.current.currentSelected).toEqual(["option-a"]);
    expect(result.current.isSubmitted).toBe(true);
    expect(result.current.currentFeedback).toEqual(feedback);
    expect(result.current.currentFeedback?.feedback_released).toBe(false);
    expect(result.current.submittedCount).toBe(1);
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate clicks and updates the original question after navigation", async () => {
    let resolveFlag!: (saved: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementationOnce(() =>
      new Promise((resolve) => { resolveFlag = resolve; }),
    );
    const { result } = await loadAttempt();
    act(() => result.current.handleSelect("option-a"));
    act(() => {
      void result.current.handleToggleFlag();
      void result.current.handleToggleFlag();
    });
    act(() => result.current.handleSubmit());
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(setQuestionFlag).toHaveBeenCalledTimes(1);
    expect(result.current.isSavingFlag).toBe(true);
    expect(result.current.flagPendingQuestionId).toBe(firstId);
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.canToggleFlag).toBe(false);
    act(() => { expect(result.current.goToQuestion(1)).toBe(true); });
    await act(async () => { resolveFlag(confirmation()); });
    expect(result.current.isSavingFlag).toBe(false);
    expect(result.current.currentQuestion?.id).toBe(secondId);
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.flaggedQuestionIds).toEqual([firstId]);
  });

  it("keeps the last confirmed flag on failure and supports retry", async () => {
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(new ApiError(500, "Save failed"));
    const { result } = await loadAttempt();
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.flagError).toBe("Save failed");
    expect(result.current.canToggleFlag).toBe(true);
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.flagError).toBe("");
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.flagError).toBe("Save failed");
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.isFlagged).toBe(true);
    expect(result.current.flagError).toBe("");
  });

  it("rejects a mismatched response", async () => {
    vi.mocked(setQuestionFlag).mockResolvedValueOnce(confirmation(true, secondId));
    const { result } = await loadAttempt();
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.flaggedQuestionIds).toEqual([]);
    expect(result.current.flagError).toContain("Unexpected flag response");
  });

  it("uses the existing authentication handler on 401", async () => {
    const expired = new ApiError(401, "Expired");
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(expired);
    const { result } = await loadAttempt();
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(handleError).toHaveBeenCalledWith(expired);
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.isSavingFlag).toBe(false);
  });

  it("disables further flagging if the backend reports a finalized attempt", async () => {
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(new ApiError(409, "Already submitted"));
    const { result } = await loadAttempt();
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(result.current.flagError).toContain("already been submitted");
    expect(result.current.canToggleFlag).toBe(false);
    await act(async () => { await result.current.handleToggleFlag(); });
    expect(setQuestionFlag).toHaveBeenCalledTimes(1);
  });

  it("ignores a late flag response from a previous attempt sharing the same question", async () => {
    let resolveFlag!: (saved: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementationOnce(() =>
      new Promise((resolve) => { resolveFlag = resolve; }),
    );
    const { result, rerender } = await loadAttempt();
    act(() => { void result.current.handleToggleFlag(); });
    vi.mocked(getExam).mockResolvedValue(makeAttempt("attempt-2"));
    rerender({ id: "attempt-2" });
    await waitFor(() => expect(result.current.canToggleFlag).toBe(true));
    await act(async () => { resolveFlag(confirmation()); });
    expect(result.current.isFlagged).toBe(false);
    expect(result.current.flaggedQuestionIds).toEqual([]);
    expect(result.current.isSavingFlag).toBe(false);
  });

  it("does not finalize an exam while a flag request is pending", async () => {
    let resolveFlag!: (saved: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementationOnce(() =>
      new Promise((resolve) => { resolveFlag = resolve; }),
    );
    const data = makeAttempt();
    for (const question of data.questions) {
      question.response = {
        question_version_id: question.id,
        selected_option_ids: question.id === firstId ? ["option-a"] : null,
        text_response: question.id === secondId ? "Answer" : null,
        is_submitted: true,
        answered_at: "2026-11-23T00:00:00Z",
      };
    }
    vi.mocked(getExam).mockResolvedValue(data);
    const { result } = await loadAttempt();
    expect(result.current.allQuestionsSubmitted).toBe(true);
    act(() => { void result.current.handleToggleFlag(); });
    await act(async () => { await result.current.handleFinish(); });
    expect(submitExam).not.toHaveBeenCalled();
    await act(async () => { resolveFlag(confirmation()); });
    expect(result.current.isSavingFlag).toBe(false);
    expect(result.current.allQuestionsSubmitted).toBe(true);
  });
});
