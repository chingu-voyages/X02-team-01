import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt, QuestionFeedback } from "@/types/exam-api.types";
import type { FinalExamSubmissionResponse } from "@/types/exam-submission.types";
import { useExamAttempt } from "./useExamAttempt";

const { session, replace } = vi.hoisted(() => ({
  session: { token: "token-A" as string | null, ready: true, handleError: vi.fn() },
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession: () => session }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn(), setQuestionFlag: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function attempt(id = "attempt-A"): ExamAttempt {
  return {
    attempt_id: id, certification_id: "cert", status: "in_progress", current_position: 1, question_count: 2,
    questions: ["essay-1", "essay-2"].map((questionId, index) => ({
      id: questionId, position: index + 1, question_text: `Essay ${index + 1}`, question_type: "essay" as const,
      allows_multiple_answers: false, difficulty: "medium" as const, options: [], images: [],
    })),
  };
}
function savedAttempt(id = "attempt-A"): ExamAttempt {
  const data = attempt(id);
  for (const question of data.questions) question.response = {
    question_version_id: question.id, selected_option_ids: null, text_response: `Saved ${question.id}`,
    is_submitted: true, answered_at: "2026-11-27T00:00:00Z", is_correct: null,
  };
  return data;
}
function confirmation(id = "attempt-A", question = "essay-1"): QuestionFeedback {
  return { attempt_id: id, question_version_id: question, is_submitted: true, feedback_released: false, is_correct: null, correct_option_ids: null, explanation: null };
}
async function load() {
  const hook = renderHook(({ id }) => useExamAttempt(id), { initialProps: { id: "attempt-A" } });
  await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
  return hook;
}

beforeEach(() => {
  vi.resetAllMocks();
  session.token = "token-A";
  session.ready = true;
  vi.mocked(getExam).mockResolvedValue(attempt());
  vi.mocked(submitAnswer).mockResolvedValue(confirmation());
});
afterEach(cleanup);

describe("JHEP-120 attempt submission safety", () => {
  it("sends the exact essay and locks only after server confirmation", async () => {
    const pending = deferred<QuestionFeedback>();
    vi.mocked(submitAnswer).mockReturnValue(pending.promise);
    const { result } = await load();
    const text = "  First paragraph.\n\n\tSecond 😀.  ";
    act(() => result.current.handleTextChange(text));
    act(() => { void result.current.handleSubmit(); });
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.isSubmitting).toBe(true);
    expect(submitAnswer).toHaveBeenCalledExactlyOnceWith("attempt-A", "essay-1", { selected_option_ids: null, text_response: text }, "token-A");
    await act(async () => pending.resolve(confirmation()));
    expect(result.current.isSubmitted).toBe(true);
    expect(result.current.currentFeedback?.is_correct).toBeNull();
  });

  it("blocks two submissions fired in the same React batch", async () => {
    const pending = deferred<QuestionFeedback>();
    vi.mocked(submitAnswer).mockReturnValue(pending.promise);
    const { result } = await load();
    act(() => result.current.handleTextChange("Draft"));
    act(() => { void result.current.handleSubmit(); void result.current.handleSubmit(); });
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(confirmation()));
  });

  it.each([" \n\t", "x".repeat(10_001)])("rejects invalid content even when the handler is called directly", async (text) => {
    const { result } = await load();
    act(() => result.current.handleTextChange(text));
    await act(async () => { await result.current.handleSubmit(); });
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(result.current.textValue).toBe(text);
    expect(result.current.submitError).not.toBe("");
  });

  it("preserves drafts through navigation without submitting", async () => {
    const { result } = await load();
    act(() => result.current.handleTextChange("First draft"));
    act(() => { result.current.goToQuestion(1); });
    act(() => result.current.handleTextChange("Second draft"));
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.textValue).toBe("First draft");
    expect(result.current.submittedCount).toBe(0);
    expect(result.current.questionStates.map((q) => q.responseState)).toEqual(["unsubmitted", "unsubmitted"]);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(getExam).toHaveBeenCalledTimes(1);
  });

  it("blocks navigation and editing while the submission is in flight", async () => {
    const pending = deferred<QuestionFeedback>();
    vi.mocked(submitAnswer).mockReturnValue(pending.promise);
    const { result } = await load();
    act(() => result.current.handleTextChange("Original"));
    act(() => {
      void result.current.handleSubmit();
      result.current.handleTextChange("Should not replace it");
      expect(result.current.goToQuestion(1)).toBe(false);
    });
    expect(result.current.textValue).toBe("Original");
    await act(async () => pending.resolve(confirmation()));
  });

  it("retains the exact draft after a failure and permits an identical retry", async () => {
    vi.mocked(submitAnswer).mockRejectedValueOnce(new ApiError(503, "Temporarily unavailable"));
    const { result } = await load();
    act(() => result.current.handleTextChange("  Preserved\n\ndraft  "));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.textValue).toBe("  Preserved\n\ndraft  ");
    await act(async () => { await result.current.handleSubmit(); });
    expect(submitAnswer).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitAnswer).mock.calls[0][2]).toEqual(vi.mocked(submitAnswer).mock.calls[1][2]);
    expect(result.current.isSubmitted).toBe(true);
  });

  it("does not accept success for a different question", async () => {
    vi.mocked(submitAnswer).mockResolvedValue(confirmation("attempt-A", "foreign-question"));
    const { result } = await load();
    act(() => result.current.handleTextChange("Keep me"));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.textValue).toBe("Keep me");
    expect(result.current.submitError).toMatch(/could not confirm/);
  });

  it("reconciles a 409 without erasing any other question's draft", async () => {
    const server = attempt();
    server.questions[0].response = { question_version_id: "essay-1", selected_option_ids: null,
      text_response: "Saved in another tab", is_submitted: true, answered_at: "2026-11-27T00:00:00Z" };
    vi.mocked(getExam).mockResolvedValueOnce(attempt()).mockResolvedValueOnce(server);
    vi.mocked(submitAnswer).mockRejectedValue(new ApiError(409, "Already submitted"));
    const { result } = await load();
    act(() => result.current.handleTextChange("My unsent first draft"));
    act(() => { result.current.goToQuestion(1); });
    act(() => result.current.handleTextChange("My second draft"));
    act(() => { result.current.goToQuestion(0); });
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.isSubmitted).toBe(true);
    expect(result.current.textValue).toBe("Saved in another tab");
    expect(result.current.unsentDraft).toBe("My unsent first draft");
    act(() => { result.current.goToQuestion(1); });
    expect(result.current.textValue).toBe("My second draft");
    expect(result.current.isSubmitted).toBe(false);
  });

  it("preserves drafts when conflict reconciliation itself fails", async () => {
    vi.mocked(getExam).mockResolvedValueOnce(attempt()).mockRejectedValueOnce(new Error("Offline"));
    vi.mocked(submitAnswer).mockRejectedValue(new ApiError(409, "Already submitted"));
    const { result } = await load();
    act(() => result.current.handleTextChange("Do not lose this"));
    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.textValue).toBe("Do not lose this");
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.submitError).toMatch(/has not been replaced/);
  });

  it("hides the old attempt during a switch and ignores its late success", async () => {
    const submit = deferred<QuestionFeedback>();
    const secondLoad = deferred<ExamAttempt>();
    vi.mocked(submitAnswer).mockReturnValue(submit.promise);
    vi.mocked(getExam).mockResolvedValueOnce(attempt()).mockReturnValueOnce(secondLoad.promise);
    const { result, rerender } = await load();
    act(() => result.current.handleTextChange("Private old draft"));
    act(() => { void result.current.handleSubmit(); });
    rerender({ id: "attempt-B" });
    expect(result.current.loadStatus).toBe("loading");
    expect(result.current.questions).toEqual([]);
    expect(result.current.textValue).toBe("");
    await act(async () => secondLoad.resolve(attempt("attempt-B")));
    await act(async () => submit.resolve(confirmation()));
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.textValue).toBe("");
  });

  it("ignores stale authentication errors after an account change", async () => {
    const submit = deferred<QuestionFeedback>();
    vi.mocked(submitAnswer).mockReturnValue(submit.promise);
    const { result, rerender } = await load();
    act(() => result.current.handleTextChange("Account A draft"));
    act(() => { void result.current.handleSubmit(); });
    session.token = "token-B";
    rerender({ id: "attempt-A" });
    await waitFor(() => expect(result.current.loadStatus).toBe("ready"));
    await act(async () => submit.reject(new ApiError(401, "Expired old session")));
    expect(session.handleError).not.toHaveBeenCalled();
    expect(result.current.textValue).toBe("");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("does not let an old request clear a new attempt's pending state", async () => {
    const old = deferred<QuestionFeedback>();
    const fresh = deferred<QuestionFeedback>();
    vi.mocked(submitAnswer).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.mocked(getExam).mockResolvedValueOnce(attempt()).mockResolvedValueOnce(attempt("attempt-B"));
    const { result, rerender } = await load();
    act(() => result.current.handleTextChange("Old draft"));
    act(() => { void result.current.handleSubmit(); });
    rerender({ id: "attempt-B" });
    await waitFor(() => expect(result.current.loadStatus).toBe("ready"));
    act(() => result.current.handleTextChange("New draft"));
    act(() => { void result.current.handleSubmit(); });
    await act(async () => old.resolve(confirmation()));
    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.isSubmitted).toBe(false);
    await act(async () => fresh.resolve(confirmation("attempt-B")));
    expect(result.current.isSubmitted).toBe(true);
  });

  it("does not navigate using a final-submit response from a previous attempt", async () => {
    const finish = deferred<FinalExamSubmissionResponse>();
    vi.mocked(submitExam).mockReturnValue(finish.promise);
    vi.mocked(getExam).mockResolvedValueOnce(savedAttempt()).mockResolvedValueOnce(savedAttempt("attempt-B"));
    const { result, rerender } = await load();
    act(() => { void result.current.handleFinish(); });
    rerender({ id: "attempt-B" });
    await waitFor(() => expect(result.current.loadStatus).toBe("ready"));
    await act(async () => finish.resolve({ attempt_id: "attempt-A", status: "submitted",
      question_count: 2, answered_count: 2, unanswered_count: 0,
      submitted_at: "2026-11-27T00:00:00Z", results_url: "/ignored" }));
    expect(replace).not.toHaveBeenCalled();
    expect(result.current.isFinishing).toBe(false);
  });

  it("prevents every mutation of a finally submitted attempt", async () => {
    vi.mocked(getExam).mockResolvedValue({ ...savedAttempt(), status: "submitted" });
    const { result } = await load();
    act(() => result.current.handleTextChange("Changed"));
    await act(async () => {
      await result.current.handleSubmit(); await result.current.handleToggleFlag(); await result.current.handleFinish();
    });
    expect(result.current.textValue).toBe("Saved essay-1");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(setQuestionFlag).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(result.current.canToggleFlag).toBe(false);
  });

  it("rejects an initial load belonging to another attempt", async () => {
    vi.mocked(getExam).mockResolvedValue(attempt("foreign"));
    const { result } = renderHook(() => useExamAttempt("attempt-A"));
    await waitFor(() => expect(result.current.loadStatus).toBe("error"));
    expect(result.current.questions).toEqual([]);
    expect(result.current.loadError).toMatch(/Unexpected exam response/);
  });
});
