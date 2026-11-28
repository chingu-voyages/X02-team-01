import { afterEach, describe, expect, it, vi } from "vitest";
import { getCompletedQuestionReview, parseCompletedQuestionReview, questionReviewHref, reviewNeighbors } from "./exam-question-review";
import { attemptId, versionId, otherId, firstId, detail } from "./exam-question-review.fixture";

afterEach(() => { vi.unstubAllGlobals(); });

describe("completed question review contract", () => {
  it("preserves original content and saved status without regrading; orders options", () => {
    const result = parseCompletedQuestionReview({ ...detail, options: [...detail.options].reverse(), extra_private_field: "not exposed" }, attemptId, versionId);
    expect(result).toEqual(detail);
  });
  it.each([
    { attempt_id: otherId }, { question_version_id: otherId }, { attempt_status: "in_progress" },
    { position: 0 }, { position: 3 }, { question_status: "invented" }, { options: [] },
    { options: [detail.options[0], detail.options[0]] }, { correct_option_ids: [otherId] },
    { correct_option_ids: [firstId, firstId] }, { correct_option_ids: [] },
    { submitted_response: { ...detail.submitted_response, is_submitted: false } },
    { submitted_response: { ...detail.submitted_response, selected_option_ids: [otherId] } },
    { images: [{ id: otherId, position: 1, alt_text: "Diagram", media_type: "image/png", url: "javascript:alert(1)" }] },
    { grading: { ...detail.grading, points_earned: -1 } }, { explanation: {} },
  ])("rejects invalid payload %j", (override) => {
    expect(() => parseCompletedQuestionReview({ ...detail, ...override }, attemptId, versionId)).toThrow("Unexpected completed question review");
  });
  it("handles unanswered, unavailable keys, and written responses", () => {
    const unanswered = { ...detail, question_status: "unanswered", submitted_response: null, correct_option_ids: null, explanation: null, grading: null };
    expect(parseCompletedQuestionReview(unanswered, attemptId, versionId)).toEqual(unanswered);
    const written = { ...unanswered, question_type: "short_answer", allows_multiple_answers: false, options: [], question_status: "pending_manual_grading", submitted_response: { ...detail.submitted_response, selected_option_ids: [], text_response: "Réponse\n日本語" } };
    expect(parseCompletedQuestionReview(written, attemptId, versionId)).toEqual(written);
  });
  it("uses the authenticated uncached GET endpoint and passes cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    expect(await getCompletedQuestionReview(attemptId, versionId, "token", signal)).toEqual(detail);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1${questionReviewHref(attemptId, versionId)}`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
  });
  it("navigates using pinned list positions and rejects mismatches", () => {
    const questions = [{ question_version_id: versionId, position: 1, preview: "First", status: "incorrect" as const }, { question_version_id: otherId, position: 2, preview: "Second", status: "correct" as const }];
    expect(reviewNeighbors(detail, questions)).toEqual({ previous: undefined, next: questions[1] });
    expect(reviewNeighbors({ ...detail, position: 2, question_version_id: otherId }, questions)).toEqual({ previous: questions[0], next: undefined });
    expect(() => reviewNeighbors(detail, questions.slice(1))).toThrow();
  });
});
