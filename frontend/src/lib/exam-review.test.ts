import { afterEach, describe, expect, it, vi } from "vitest";
import { getCompletedExamReview } from "./exam-review";

const attemptId = "11111111-1111-4111-8111-111111111111";
const firstId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const first = { question_version_id: firstId, position: 1, preview: "First pinned question", status: "incorrect" };
const second = { question_version_id: secondId, position: 2, preview: "Second pinned question", status: "pending_manual_grading" };
const payload = { attempt_id: attemptId, status: "submitted", question_count: 2, questions: [first, second] };

function mockResponse(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("getCompletedExamReview", () => {
  it("uses an authenticated uncached GET and keeps only the ordered preview fields", async () => {
    const fetch = mockResponse({ ...payload, questions: [{ ...second, expected_answer: "private key" }, { ...first, explanation: "private explanation" }] });
    const controller = new AbortController();
    await expect(getCompletedExamReview(attemptId, "test-token", controller.signal)).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/exams/${attemptId}/review`, expect.objectContaining({ method: "GET", cache: "no-store", signal: controller.signal }));
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("permits an empty historical review for the unavailable state", async () => {
    mockResponse({ ...payload, questions: [] });
    await expect(getCompletedExamReview(attemptId, "test-token")).resolves.toMatchObject({ questions: [] });
  });

  it.each([
    { ...payload, attempt_id: secondId },
    { ...payload, status: "in_progress" },
    { ...payload, questions: null },
    { ...payload, questions: [first] },
    { ...payload, questions: [first, { ...second, position: 1 }] },
    { ...payload, questions: [first, { ...second, question_version_id: firstId }] },
    { ...payload, questions: [first, { ...second, status: "unknown" }] },
    { ...payload, questions: [first, { ...second, position: 0 }] },
    { ...payload, questions: [first, { ...second, question_version_id: "invalid" }] },
    { ...payload, questions: [first, { ...second, preview: " " }] },
  ])("rejects a wrong or incomplete review payload: %#", async (body) => {
    mockResponse(body);
    await expect(getCompletedExamReview(attemptId, "test-token")).rejects.toThrow("Unexpected completed exam review received.");
  });

  it.each([401, 403, 404, 409, 500, 502])("preserves HTTP %i for safe error handling", async (status) => {
    mockResponse({ detail: "Server detail" }, status);
    await expect(getCompletedExamReview(attemptId, "test-token")).rejects.toMatchObject({ status, name: "ApiError" });
  });
});
