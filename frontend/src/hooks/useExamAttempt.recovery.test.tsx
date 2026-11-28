import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { saveExamDraft, saveExamPosition, type ExamDraftSaved } from "@/lib/exam-recovery-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt } from "@/types/exam-api.types";
import { useExamAttempt } from "./useExamAttempt";

const { session, replace, handleError } = vi.hoisted(() => ({
  session: { token: "token-a", ready: true }, replace: vi.fn(), handleError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession: () => ({ ...session, handleError }) }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn(), setQuestionFlag: vi.fn() }));
vi.mock("@/lib/exam-recovery-api", () => ({ saveExamDraft: vi.fn(), saveExamPosition: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));

const attemptId = "attempt-a";
const timestamp = "2026-11-27T20:00:00Z";
function fixture(id = attemptId): ExamAttempt {
  return {
    attempt_id: id, certification_id: "cert", status: "in_progress", current_position: 1, question_count: 3,
    questions: [1, 2, 3].map((position) => ({
      id: `q${position}`, position, question_text: `Question ${position}`,
      question_type: position === 2 ? "short_answer" : "multiple_choice",
      allows_multiple_answers: position === 3, difficulty: "easy", images: [],
      options: position === 2 ? [] : [
        { id: `q${position}-a`, position: 1, option_text: "A" },
        { id: `q${position}-b`, position: 2, option_text: "B" },
      ],
    })),
  };
}
function counts(attempt: ExamAttempt) {
  const answered = attempt.questions.filter((question) => question.response).length;
  return { question_count: attempt.question_count, answered_count: answered, unanswered_count: attempt.question_count - answered };
}
function confirmation(questionId: string, selected: string[] | null = null, text: string | null = null): ExamDraftSaved {
  return { attempt_id: attemptId, question_version_id: questionId, selected_option_ids: selected, text_response: text,
    is_submitted: false, answered_at: timestamp, question_count: 3, answered_count: 1, unanswered_count: 2 };
}
let persisted: ExamAttempt;

beforeEach(() => {
  vi.resetAllMocks();
  session.token = "token-a";
  session.ready = true;
  persisted = fixture();
  vi.mocked(getExam).mockImplementation(async () => JSON.parse(JSON.stringify(persisted)) as ExamAttempt);
  vi.mocked(saveExamDraft).mockImplementation(async (id, questionId, answer) => {
    if (id !== persisted.attempt_id) throw new Error("Wrong attempt");
    const question = persisted.questions.find((item) => item.id === questionId);
    if (!question || question.response?.is_submitted) throw new ApiError(409, "Locked");
    const selected = answer.selected_option_ids?.length ? [...answer.selected_option_ids] : null;
    const text = answer.text_response?.trim() || null;
    if (!selected && !text) delete question.response;
    else question.response = { question_version_id: questionId, selected_option_ids: selected, text_response: text, is_submitted: false, answered_at: timestamp };
    return { attempt_id: id, question_version_id: questionId, selected_option_ids: selected, text_response: text, is_submitted: false, answered_at: timestamp, ...counts(persisted) };
  });
  vi.mocked(saveExamPosition).mockImplementation(async (id, position) => {
    if (id !== persisted.attempt_id) throw new Error("Wrong attempt");
    persisted.current_position = position;
    return { attempt_id: id, status: "in_progress", current_position: position, ...counts(persisted) };
  });
  vi.mocked(submitAnswer).mockImplementation(async (_id, questionId) => {
    const question = persisted.questions.find((item) => item.id === questionId);
    if (!question?.response) throw new Error("Draft not saved before submission");
    question.response.is_submitted = true;
    return { question_version_id: questionId, is_submitted: true, feedback_released: false };
  });
});
afterEach(cleanup);

async function load(id = attemptId) {
  const hook = renderHook(({ attempt }) => useExamAttempt(attempt), { initialProps: { attempt: id } });
  await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
  return hook;
}
function flushBackground() {
  act(() => { window.dispatchEvent(new Event("pagehide")); });
}
function unloadWarning() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("JHEP-89 exam recovery integration", () => {
  it("hydrates existing answers and position without writing or unlocking a submitted response", async () => {
    persisted.current_position = 2;
    persisted.questions[0].response = { question_version_id: "q1", selected_option_ids: ["q1-a"], text_response: null, is_submitted: true, answered_at: timestamp };
    persisted.questions[1].response = { question_version_id: "q2", selected_option_ids: null, text_response: "Saved text", is_submitted: false, answered_at: timestamp };
    const { result } = await load();
    expect(result.current.currentQuestionIndex).toBe(1);
    expect(result.current.textValue).toBe("Saved text");
    expect(result.current.submittedCount).toBe(1);
    expect(result.current.saveState.status).toBe("idle");
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(saveExamPosition).not.toHaveBeenCalled();
    expect(unloadWarning()).toBe(false);
    act(() => { result.current.goToQuestion(0); });
    expect(result.current.isSubmitted).toBe(true);
    act(() => result.current.handleSelect("q1-b"));
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(saveExamDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.saveState.status).toBe("saved"));
  });

  it("saves all draft types and restores the same attempt and question on a fresh mount", async () => {
    const hook = await load();
    const { result } = hook;
    act(() => result.current.handleSelect("q1-a"));
    act(() => result.current.handleSelect("q1-b"));
    act(() => { result.current.goToQuestion(1); });
    act(() => result.current.handleTextChange("First draft"));
    act(() => result.current.handleTextChange("  Final draft  "));
    act(() => { result.current.goToQuestion(2); });
    // Both callbacks in one React batch must see the latest selection.
    act(() => { result.current.handleSelect("q3-a"); result.current.handleSelect("q3-b"); });
    expect(result.current.currentSelected).toEqual(["q3-a", "q3-b"]);
    flushBackground();
    await waitFor(() => expect(result.current.saveState.status).toBe("saved"));
    expect(persisted.current_position).toBe(3);
    expect(persisted.questions.map((question) => question.response?.is_submitted)).toEqual([false, false, false]);
    expect(persisted.questions[0].response?.selected_option_ids).toEqual(["q1-b"]);
    expect(persisted.questions[1].response?.text_response).toBe("Final draft");
    expect(persisted.questions[2].response?.selected_option_ids).toEqual(["q3-a", "q3-b"]);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    const writes = vi.mocked(saveExamDraft).mock.calls.length;
    hook.unmount();
    const resumed = await load();
    expect(resumed.result.current.currentQuestionIndex).toBe(2);
    expect(resumed.result.current.currentSelected).toEqual(["q3-a", "q3-b"]);
    expect(resumed.result.current.isSubmitted).toBe(false);
    expect(resumed.result.current.submittedCount).toBe(0);
    expect(saveExamDraft).toHaveBeenCalledTimes(writes);
    act(() => { resumed.result.current.goToQuestion(1); });
    expect(resumed.result.current.textValue).toBe("Final draft");
    await waitFor(() => expect(resumed.result.current.saveState.status).toBe("saved"));
  });

  it("clears saved selections and text explicitly instead of resurrecting them on reload", async () => {
    persisted.current_position = 3;
    persisted.questions[2].response = { question_version_id: "q3", selected_option_ids: ["q3-a"], text_response: null, is_submitted: false, answered_at: timestamp };
    persisted.questions[1].response = { question_version_id: "q2", selected_option_ids: null, text_response: "Old answer", is_submitted: false, answered_at: timestamp };
    const hook = await load();
    act(() => hook.result.current.handleSelect("q3-a"));
    act(() => { hook.result.current.goToQuestion(1); });
    act(() => hook.result.current.handleTextChange(""));
    flushBackground();
    await waitFor(() => expect(hook.result.current.saveState.status).toBe("saved"));
    expect(persisted.questions[1].response).toBeUndefined();
    expect(persisted.questions[2].response).toBeUndefined();
    expect(saveExamDraft).toHaveBeenCalledWith(attemptId, "q3", { selected_option_ids: null, text_response: null }, "token-a", expect.any(AbortSignal));
    hook.unmount();
    const resumed = await load();
    expect(resumed.result.current.textValue).toBe("");
    act(() => { resumed.result.current.goToQuestion(2); });
    expect(resumed.result.current.currentSelected).toEqual([]);
    await waitFor(() => expect(resumed.result.current.saveState.status).toBe("saved"));
  });

  it("does not save invalid selections, an unchanged single choice or the already-active position", async () => {
    persisted.questions[0].response = { question_version_id: "q1", selected_option_ids: ["q1-a"], text_response: null, is_submitted: false, answered_at: timestamp };
    const { result } = await load();
    act(() => {
      result.current.handleSelect("q1-a");
      result.current.handleSelect("foreign-option");
      result.current.handleTextChange("not a written question");
      expect(result.current.goToQuestion(0)).toBe(true);
      expect(result.current.goToQuestion(99)).toBe(false);
    });
    flushBackground();
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(saveExamPosition).not.toHaveBeenCalled();
  });

  it("retains newer input after a failed save and retries only the latest draft", async () => {
    persisted.current_position = 2;
    persisted.questions[1].response = { question_version_id: "q2", selected_option_ids: null, text_response: "Previously saved", is_submitted: false, answered_at: timestamp };
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(503, "Offline"));
    const { result } = await load();
    act(() => result.current.handleTextChange("Unsaved first edit"));
    expect(unloadWarning()).toBe(true);
    flushBackground();
    await waitFor(() => expect(result.current.saveState.status).toBe("error"));
    expect(persisted.questions[1].response?.text_response).toBe("Previously saved");
    act(() => result.current.handleTextChange("Newest edit"));
    expect(result.current.textValue).toBe("Newest edit");
    expect(result.current.canRetrySave).toBe(true);
    expect(saveExamDraft).toHaveBeenCalledTimes(1);
    expect(unloadWarning()).toBe(true);
    act(() => result.current.retrySave());
    await waitFor(() => expect(result.current.saveState.status).toBe("saved"));
    expect(persisted.questions[1].response?.text_response).toBe("Newest edit");
    expect(saveExamDraft).toHaveBeenCalledTimes(2);
    expect(unloadWarning()).toBe(false);
  });

  it.each([401, 403, 404, 409])("does not blindly replay an unauthorized, missing or conflicting save (%s)", async (status) => {
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(status, "Save rejected"));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    flushBackground();
    await waitFor(() => expect(result.current.saveState.status).toBe("error"));
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(result.current.canRetrySave).toBe(false);
    act(() => result.current.retrySave());
    expect(saveExamDraft).toHaveBeenCalledTimes(1);
    // Do not force a logout and throw away the only copy of unsaved input.
    expect(handleError).not.toHaveBeenCalled();
  });

  it("waits for the draft acknowledgement before submitting, and blocks duplicate clicks", async () => {
    let release!: (value: ExamDraftSaved) => void;
    vi.mocked(saveExamDraft).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.mocked(submitAnswer).mockResolvedValue({ question_version_id: "q1", is_submitted: true, feedback_released: false });
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => { void result.current.handleSubmit(); void result.current.handleSubmit(); });
    expect(result.current.isSubmitting).toBe(true);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(result.current.saveState.status).toBe("saving");
    act(() => { expect(result.current.goToQuestion(1)).toBe(false); });
    await act(async () => release(confirmation("q1", ["q1-a"])));
    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(result.current.currentFeedback?.feedback_released).toBe(false);
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    act(() => result.current.handleSelect("q1-b"));
    expect(saveExamDraft).toHaveBeenCalledTimes(1);
  });

  it("blocks submission on a failed draft save until the learner successfully retries", async () => {
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(500, "Failed"));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(result.current.saveState.status).toBe("error");
    expect(result.current.submitError).toContain("Save your progress");
    expect(result.current.isSubmitted).toBe(false);
    expect(submitAnswer).not.toHaveBeenCalled();
    act(() => result.current.retrySave());
    await waitFor(() => expect(result.current.saveState.status).toBe("saved"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("does not finish an exam while the final position save failed", async () => {
    for (const question of persisted.questions) {
      question.response = { question_version_id: question.id, selected_option_ids: question.options.length ? [question.options[0].id] : null,
        text_response: question.options.length ? null : "Answer", is_submitted: true, answered_at: timestamp };
    }
    vi.mocked(saveExamPosition).mockRejectedValueOnce(new ApiError(503, "Position failed"));
    const { result } = await load();
    act(() => { result.current.goToQuestion(2); });
    await waitFor(() => expect(result.current.saveState.status).toBe("error"));
    await act(async () => { await result.current.handleFinish(); });
    expect(submitExam).not.toHaveBeenCalled();
    expect(result.current.finishError).toContain("Save your progress");
    expect(result.current.isFinishing).toBe(false);
  });

  it("aborts old work and hides old answers when an authenticated account or attempt changes", async () => {
    let release!: (value: ExamDraftSaved) => void;
    let oldSignal: AbortSignal | undefined;
    vi.mocked(saveExamDraft).mockImplementationOnce((_id, _question, _answer, _token, signal) => {
      oldSignal = signal;
      return new Promise((resolve) => { release = resolve; });
    });
    const hook = await load();
    act(() => hook.result.current.handleSelect("q1-a"));
    flushBackground();
    await waitFor(() => expect(saveExamDraft).toHaveBeenCalledTimes(1));
    session.token = "token-b";
    persisted = fixture("attempt-b");
    hook.rerender({ attempt: "attempt-b" });
    expect(hook.result.current.loadStatus).toBe("loading");
    expect(hook.result.current.questions).toEqual([]);
    await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => release(confirmation("q1", ["q1-a"])));
    expect(hook.result.current.currentSelected).toEqual([]);
    expect(hook.result.current.saveState.status).toBe("idle");
    act(() => hook.result.current.handleSelect("q1-b"));
    flushBackground();
    await waitFor(() => expect(hook.result.current.saveState.status).toBe("saved"));
    expect(saveExamDraft).toHaveBeenLastCalledWith("attempt-b", "q1", { selected_option_ids: ["q1-b"], text_response: null }, "token-b", expect.any(AbortSignal));
  });

  it("retries a failed recovery GET without creating or editing an attempt", async () => {
    vi.mocked(getExam).mockRejectedValueOnce(new ApiError(404, "Exam attempt not found"));
    const hook = renderHook(() => useExamAttempt(attemptId));
    await waitFor(() => expect(hook.result.current.loadStatus).toBe("error"));
    expect(hook.result.current.questions).toEqual([]);
    act(() => hook.result.current.retryLoading());
    await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
    expect(getExam).toHaveBeenCalledTimes(2);
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(saveExamPosition).not.toHaveBeenCalled();
  });

  it("keeps an already submitted attempt read-only and offers its results", async () => {
    persisted.status = "submitted";
    const { result } = await load();
    expect(result.current.isAttemptSubmitted).toBe(true);
    act(() => { result.current.handleSelect("q1-a"); expect(result.current.goToQuestion(2)).toBe(false); });
    act(() => result.current.viewResults());
    expect(replace).toHaveBeenCalledWith(`/exams/${attemptId}/results`);
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(saveExamPosition).not.toHaveBeenCalled();
  });
});

describe("JHEP-89 save and leave", () => {
  it("waits for the last draft before leaving and never submits", async () => {
    let release!: (value: ExamDraftSaved) => void;
    vi.mocked(saveExamDraft).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => { void result.current.handleSaveAndLeave(); void result.current.handleSaveAndLeave(); });
    expect(result.current.isLeaving).toBe(true);
    expect(result.current.canSaveAndLeave).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    act(() => {
      result.current.handleSelect("q1-b");
      result.current.handleSubmit();
      expect(result.current.goToQuestion(1)).toBe(false);
    });
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    await act(async () => release(confirmation("q1", ["q1-a"])));
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/categories"));
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("stays on the exam after a failed save and supports save-and-leave retry", async () => {
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(503, "Offline"));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    await act(async () => result.current.handleSaveAndLeave());
    expect(result.current.isLeaving).toBe(false);
    expect(result.current.leaveError).toContain("not saved yet");
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => result.current.handleSaveAndLeave());
    expect(replace).toHaveBeenCalledExactlyOnceWith("/categories");
    expect(persisted.questions[0].response?.is_submitted).toBe(false);
  });

  it("never retries an authorization failure or leaves with unsaved work", async () => {
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(401, "Expired"));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    await act(async () => result.current.handleSaveAndLeave());
    await act(async () => result.current.handleSaveAndLeave());
    expect(saveExamDraft).toHaveBeenCalledTimes(1);
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores a late leave confirmation from an old session", async () => {
    let release!: (value: ExamDraftSaved) => void;
    vi.mocked(saveExamDraft).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const hook = await load();
    act(() => hook.result.current.handleSelect("q1-a"));
    act(() => { void hook.result.current.handleSaveAndLeave(); });
    session.token = "token-b";
    persisted = fixture("attempt-b");
    hook.rerender({ attempt: "attempt-b" });
    await waitFor(() => expect(hook.result.current.loadStatus).toBe("ready"));
    await act(async () => release(confirmation("q1", ["q1-a"])));
    expect(replace).not.toHaveBeenCalled();
    expect(hook.result.current.isLeaving).toBe(false);
  });
});

describe("JHEP-89 version-aware autosave", () => {
  it("uses the acknowledged revision for every subsequent write and question submission", async () => {
    persisted.recovery_revision = 4;
    vi.mocked(saveExamDraft).mockResolvedValueOnce({ ...confirmation("q1", ["q1-a"]), recovery_revision: 5 });
    vi.mocked(submitAnswer).mockResolvedValueOnce({ question_version_id: "q1", is_submitted: true, feedback_released: false, recovery_revision: 6 });
    vi.mocked(saveExamPosition).mockResolvedValueOnce({ attempt_id: attemptId, status: "in_progress", current_position: 2, question_count: 3, answered_count: 1, unanswered_count: 2, recovery_revision: 7 });
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitted).toBe(true));
    expect(saveExamDraft).toHaveBeenCalledWith(attemptId, "q1", { selected_option_ids: ["q1-a"], text_response: null }, "token-a", expect.any(AbortSignal), 4);
    expect(submitAnswer).toHaveBeenCalledWith(attemptId, "q1", { selected_option_ids: ["q1-a"], text_response: null, expected_revision: 5 }, "token-a");
    act(() => { result.current.goToQuestion(1); });
    await waitFor(() => expect(result.current.saveState.status).toBe("saved"));
    expect(saveExamPosition).toHaveBeenCalledWith(attemptId, 2, "token-a", expect.any(AbortSignal), 6);
  });

  it("keeps the stale selection visible and blocks blind retries and leaving", async () => {
    persisted.recovery_revision = 1;
    vi.mocked(saveExamDraft).mockRejectedValueOnce(new ApiError(409, "Changed", { code: "RECOVERY_REVISION_CONFLICT" }));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    await act(async () => result.current.handleSaveAndLeave());
    expect(result.current.saveState.status).toBe("error");
    expect(result.current.saveErrorMessage).toContain("another tab");
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(result.current.canRetrySave).toBe(false);
    act(() => result.current.retrySave());
    await act(async () => result.current.handleSaveAndLeave());
    expect(saveExamDraft).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats a missing version acknowledgement as uncertain, without submitting or reloading", async () => {
    persisted.recovery_revision = 0;
    vi.mocked(saveExamDraft).mockResolvedValueOnce(confirmation("q1", ["q1-a"]));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(result.current.saveState.status).toBe("error");
    expect(result.current.canRetrySave).toBe(false);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(getExam).toHaveBeenCalledTimes(1);
  });

  it("does not discard the current view when the revision changes before submission", async () => {
    persisted.recovery_revision = 0;
    vi.mocked(saveExamDraft).mockResolvedValueOnce({ ...confirmation("q1", ["q1-a"]), recovery_revision: 1 });
    vi.mocked(submitAnswer).mockRejectedValueOnce(new ApiError(409, "Changed", { code: "RECOVERY_REVISION_CONFLICT" }));
    const { result } = await load();
    act(() => result.current.handleSelect("q1-a"));
    act(() => result.current.handleSubmit());
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(result.current.submitError).toContain("another tab");
    expect(result.current.isSubmitted).toBe(false);
    expect(result.current.currentSelected).toEqual(["q1-a"]);
    expect(getExam).toHaveBeenCalledTimes(1);
  });

  it("uses the loaded revision when finishing an already answered exam", async () => {
    persisted.recovery_revision = 9;
    for (const question of persisted.questions) {
      question.response = {
        question_version_id: question.id,
        selected_option_ids: question.options.length ? [question.options[0].id] : null,
        text_response: question.options.length ? null : "Answer",
        is_submitted: true,
        answered_at: timestamp,
      };
    }
    vi.mocked(submitExam).mockResolvedValueOnce({
      attempt_id: attemptId, status: "submitted", question_count: 3,
      answered_count: 3, unanswered_count: 0, submitted_at: timestamp,
      results_url: `/api/v1/exams/${attemptId}/results`, recovery_revision: 10,
    });
    const { result } = await load();
    await act(async () => result.current.handleFinish());
    expect(submitExam).toHaveBeenCalledExactlyOnceWith(attemptId, "token-a", 9);
    expect(replace).toHaveBeenCalledExactlyOnceWith(`/exams/${attemptId}/results`);
  });

});

describe("JHEP-89 device recovery across mounts", () => {
  const deviceAttempt = "11111111-1111-4111-8111-111111111111";
  const account = "22222222-2222-4222-8222-222222222222";
  const otherAccount = "33333333-3333-4333-8333-333333333333";
  function accountToken(subject: string) { return `header.${btoa(JSON.stringify({ sub: subject })).replace(/=+$/, "")}.signature`; }
  function deviceKeys() { return Object.keys(localStorage).filter((key) => key.startsWith("jhep.exam-recovery.v1:")); }
  beforeEach(() => {
    localStorage.clear();
    session.token = accountToken(account);
    persisted = { ...fixture(deviceAttempt), recovery_revision: 0, current_position: 2 };
  });
  afterEach(() => localStorage.clear());

  it("journals text before the debounce and restores it after closing and authenticating again", async () => {
    const hook = await load(deviceAttempt);
    act(() => hook.result.current.handleTextChange("Unsent written answer"));
    expect(hook.result.current.deviceCopySaved).toBe(true);
    expect(deviceKeys()).toHaveLength(1);
    expect(saveExamDraft).not.toHaveBeenCalled();
    hook.unmount();
    session.token = `${accountToken(account)}-new-session`;
    const returned = await load(deviceAttempt);
    expect(returned.result.current.recoveryCopies).toHaveLength(1);
    expect(returned.result.current.recoveryCopies[0].canRestore).toBe(true);
    expect(returned.result.current.textValue).toBe("");
    expect(saveExamDraft).not.toHaveBeenCalled();
    vi.mocked(saveExamDraft).mockImplementationOnce(async (id, questionId, answer) => {
      persisted.questions[1].response = { question_version_id: questionId, selected_option_ids: null, text_response: answer.text_response, is_submitted: false, answered_at: timestamp };
      persisted.recovery_revision = 1;
      return { ...confirmation(questionId, null, answer.text_response), attempt_id: id, recovery_revision: 1 };
    });
    act(() => returned.result.current.restoreRecoveryCopy(returned.result.current.recoveryCopies[0].key));
    await waitFor(() => expect(returned.result.current.saveState.status).toBe("saved"));
    expect(returned.result.current.textValue).toBe("Unsent written answer");
    expect(returned.result.current.isSubmitted).toBe(false);
    expect(deviceKeys()).toEqual([]);
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("never reads or restores a device copy under another authenticated account", async () => {
    const hook = await load(deviceAttempt);
    act(() => hook.result.current.handleTextChange("Private unfinished answer"));
    hook.unmount();
    session.token = accountToken(otherAccount);
    const returned = await load(deviceAttempt);
    expect(returned.result.current.recoveryCopies).toEqual([]);
    expect(returned.result.current.textValue).toBe("");
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(deviceKeys()).toHaveLength(1);
  });

  it("keeps newer server answers unchanged and permits non-destructive review later", async () => {
    const hook = await load(deviceAttempt);
    act(() => hook.result.current.handleTextChange("Old local edit"));
    hook.unmount();
    persisted.recovery_revision = 1;
    persisted.questions[1].response = { question_version_id: "q2", selected_option_ids: null, text_response: "Newer server answer", is_submitted: false, answered_at: timestamp };
    const returned = await load(deviceAttempt);
    const copy = returned.result.current.recoveryCopies[0];
    expect(copy.canRestore).toBe(false);
    act(() => returned.result.current.restoreRecoveryCopy(copy.key));
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(returned.result.current.textValue).toBe("Newer server answer");
    act(() => returned.result.current.continueWithSavedProgress());
    expect(returned.result.current.recoveryCopies).toEqual([]);
    expect(deviceKeys()).toHaveLength(1);
  });

  it("never exposes or replays a device copy after a recovery GET is rejected", async () => {
    const hook = await load(deviceAttempt);
    act(() => hook.result.current.handleTextChange("Private unfinished answer"));
    hook.unmount();
    vi.mocked(getExam).mockRejectedValueOnce(new ApiError(404, "Not found"));
    const returned = renderHook(() => useExamAttempt(deviceAttempt));
    await waitFor(() => expect(returned.result.current.loadStatus).toBe("error"));
    expect(returned.result.current.recoveryCopies).toEqual([]);
    expect(returned.result.current.questions).toEqual([]);
    expect(saveExamDraft).not.toHaveBeenCalled();
    expect(deviceKeys()).toHaveLength(1);
  });

  it("warns if the device copy cannot be written but allows server saving", async () => {
    const hook = await load(deviceAttempt);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    try {
      act(() => hook.result.current.handleTextChange("Keep on page"));
      expect(hook.result.current.deviceCopySaved).toBe(false);
      expect(hook.result.current.textValue).toBe("Keep on page");
      vi.mocked(saveExamDraft).mockResolvedValueOnce({ ...confirmation("q2", null, "Keep on page"), attempt_id: deviceAttempt, recovery_revision: 1 });
      flushBackground();
      await waitFor(() => expect(hook.result.current.saveState.status).toBe("saved"));
      expect(hook.result.current.deviceCopySaved).toBeNull();
      expect(hook.result.current.textValue).toBe("Keep on page");
    } finally {
      setItem.mockRestore();
    }
  });
});
