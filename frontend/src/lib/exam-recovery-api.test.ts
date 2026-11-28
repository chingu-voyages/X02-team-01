import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import {
  ExamSaveConfirmationError,
  saveExamDraft,
  saveExamPosition,
  type ExamDraftAnswer,
  type ExamDraftSaved,
  type ExamPositionSaved,
} from "./exam-recovery-api";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));

const request = vi.mocked(apiRequest);
const attemptId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const token = "test-session-token";
const choice: ExamDraftAnswer = { selected_option_ids: ["option-a"], text_response: null };

function draftSaved(overrides: Partial<ExamDraftSaved> = {}): ExamDraftSaved {
  return {
    attempt_id: attemptId,
    question_version_id: questionId,
    selected_option_ids: ["option-a"],
    is_submitted: false,
    answered_at: "2026-11-27T12:00:00Z",
    question_count: 10,
    answered_count: 1,
    unanswered_count: 9,
    ...overrides,
  };
}

function positionSaved(overrides: Partial<ExamPositionSaved> = {}): ExamPositionSaved {
  return {
    attempt_id: attemptId,
    status: "in_progress",
    current_position: 3,
    question_count: 10,
    answered_count: 1,
    unanswered_count: 9,
    ...overrides,
  };
}

beforeEach(() => {
  request.mockReset();
});

describe("JHEP-89 recovery API", () => {
  it("saves a draft through the authenticated API client without submitting", async () => {
    const response = draftSaved();
    request.mockResolvedValue(response);
    await expect(saveExamDraft(attemptId, questionId, choice, token)).resolves.toBe(response);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      `/exams/${attemptId}/responses/${questionId}`,
      token,
      { method: "PUT", body: JSON.stringify(choice) },
    );
  });

  it("encodes both path identifiers", async () => {
    request.mockResolvedValue(draftSaved({ attempt_id: "attempt/a", question_version_id: "question?b" }));
    await saveExamDraft("attempt/a", "question?b", choice, token);
    expect(request.mock.calls[0][0]).toBe("/exams/attempt%2Fa/responses/question%3Fb");
  });

  it("passes an abort signal to draft saves", async () => {
    const controller = new AbortController();
    request.mockResolvedValue(draftSaved());
    await saveExamDraft(attemptId, questionId, choice, token, controller.signal);
    expect(request.mock.calls[0][2]?.signal).toBe(controller.signal);
  });

  it("sends short-answer whitespace intact and accepts backend normalization", async () => {
    const answer = { selected_option_ids: null, text_response: "  two\nlines  " };
    request.mockResolvedValue(draftSaved({ selected_option_ids: undefined, text_response: "two\nlines" }));
    await saveExamDraft(attemptId, questionId, answer, token);
    expect(request.mock.calls[0][2]?.body).toBe(JSON.stringify(answer));
    expect(answer.text_response).toBe("  two\nlines  ");
  });

  it("accepts an explicit clear when the backend omits null fields", async () => {
    request.mockResolvedValue(draftSaved({ selected_option_ids: undefined, text_response: undefined }));
    await expect(saveExamDraft(attemptId, questionId, {
      selected_option_ids: [], text_response: null,
    }, token)).resolves.toMatchObject({ is_submitted: false });
    expect(request.mock.calls[0][2]?.body).toBe('{"selected_option_ids":[],"text_response":null}');
  });

  it("also supports explicitly clearing both nullable channels", async () => {
    request.mockResolvedValue(draftSaved({ selected_option_ids: undefined }));
    await expect(saveExamDraft(attemptId, questionId, {
      selected_option_ids: null, text_response: null,
    }, token)).resolves.toMatchObject({ is_submitted: false });
  });

  it("does not mutate selection arrays when checking multi-select acknowledgements", async () => {
    const selections = ["option-b", "option-a"];
    request.mockResolvedValue(draftSaved({ selected_option_ids: ["option-a", "option-b"] }));
    await saveExamDraft(attemptId, questionId, {
      selected_option_ids: selections, text_response: null,
    }, token);
    expect(selections).toEqual(["option-b", "option-a"]);
  });

  it.each([
    {},
    { selected_option_ids: [] },
    { text_response: "unfinished" },
    { selected_option_ids: undefined, text_response: null },
    { selected_option_ids: null, text_response: undefined },
  ])("rejects an incomplete payload instead of accidentally clearing saved work: %j", async (answer) => {
    await expect(
          saveExamDraft(attemptId, questionId, answer as unknown as ExamDraftAnswer, token),
        ).rejects.toBeInstanceOf(TypeError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { attempt_id: "another-attempt" },
    { question_version_id: "another-question" },
    { is_submitted: true },
    { selected_option_ids: ["different-option"] },
    { selected_option_ids: [] },
    { text_response: "unexpected text" },
  ])("does not report a mismatched draft acknowledgement as saved: %j", async (overrides) => {
    request.mockResolvedValue(draftSaved(overrides));
    await expect(saveExamDraft(attemptId, questionId, choice, token)).rejects.toBeInstanceOf(ExamSaveConfirmationError);
  });

  it("does not treat an empty HTTP success body as a confirmed save", async () => {
    request.mockResolvedValue(undefined);
    await expect(saveExamDraft(attemptId, questionId, choice, token)).rejects.toBeInstanceOf(ExamSaveConfirmationError);
  });

  it.each([401, 403, 404, 409, 422, 500])("preserves a %i failure for the UI to handle", async (status) => {
    const failure = Object.assign(new Error("Save failed"), { status });
    request.mockRejectedValue(failure);
    await expect(saveExamDraft(attemptId, questionId, choice, token)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("persists a 1-based position using PATCH, not a new-attempt POST", async () => {
    const response = positionSaved();
    request.mockResolvedValue(response);
    await expect(saveExamPosition(attemptId, 3, token)).resolves.toBe(response);
    expect(request).toHaveBeenCalledExactlyOnceWith(`/exams/${attemptId}/progress`, token, {
      method: "PATCH", body: '{"current_position":3}',
    });
  });

  it("encodes the attempt ID and forwards a position abort signal", async () => {
    const controller = new AbortController();
    request.mockResolvedValue(positionSaved({ attempt_id: "attempt/a" }));
    await saveExamPosition("attempt/a", 3, token, controller.signal);
    expect(request.mock.calls[0][0]).toBe("/exams/attempt%2Fa/progress");
    expect(request.mock.calls[0][2]?.signal).toBe(controller.signal);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid position %s before sending", async (position) => {
    await expect(saveExamPosition(attemptId, position, token)).rejects.toBeInstanceOf(RangeError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { attempt_id: "another-attempt" },
    { current_position: 2 },
    { status: "submitted" as const },
  ])("does not report mismatched navigation acknowledgement as saved: %j", async (overrides) => {
    request.mockResolvedValue(positionSaved(overrides));
    await expect(saveExamPosition(attemptId, 3, token)).rejects.toBeInstanceOf(ExamSaveConfirmationError);
  });

  it("preserves navigation failures and does not try to create an attempt", async () => {
    const failure = new Error("Connection lost");
    request.mockRejectedValue(failure);
    await expect(saveExamPosition(attemptId, 3, token)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
