import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createManagedQuestion,
  editManagedQuestion,
} from "./admin-question-api";

import type {
  AdminQuestionDraftCreateRequest,
  AdminQuestionDraftEditRequest,
} from "@/types/admin-question-api.types";

function mockResponse(status: number, body: unknown) {
  const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("Admin question write API", () => {
  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_API_URL",
      "http://localhost:8000/api/v1",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates a draft question with bearer authentication", async () => {
    const payload: AdminQuestionDraftCreateRequest = {
      certification_id: "11111111-1111-4111-8111-111111111111",
      category_id: "22222222-2222-4222-8222-222222222222",
      difficulty: "medium",
      question_text: "Which answer is correct?",
      question_type: "multiple_choice",
      allows_multiple_answers: false,
      explanation: "The first answer is correct.",
      options: [
        { option_text: "Correct", is_correct: true },
        { option_text: "Incorrect", is_correct: false },
      ],
      expected_answer: null,
    };

    const created = {
      question_id: "33333333-3333-4333-8333-333333333333",
      question_version_id: "44444444-4444-4444-8444-444444444444",
      version_number: 1,
      review_status: "pending",
      publication_status: "draft",
    };

    const mockFetch = mockResponse(201, created);

    const result = await createManagedQuestion("admin-token", payload);

    expect(result).toEqual(created);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/admin/questions");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer admin-token",
    );
    expect(JSON.parse(String(options?.body))).toEqual(payload);
  });

  it("edits an existing question using PATCH", async () => {
    const questionId = "33333333-3333-4333-8333-333333333333";
    const payload: AdminQuestionDraftEditRequest = {
      category_id: "22222222-2222-4222-8222-222222222222",
      difficulty: "hard",
      question_text: "Updated question",
      question_type: "short_answer",
      allows_multiple_answers: false,
      explanation: "Updated explanation",
      options: [],
      expected_answer: "Expected response",
    };

    const mockFetch = mockResponse(200, {
      question_id: questionId,
      question_version_id: "55555555-5555-4555-8555-555555555555",
      version_number: 2,
      certification_id: "11111111-1111-4111-8111-111111111111",
      certification_name: "Example Certification",
      category_id: payload.category_id,
      category_name: "Example Category",
      difficulty: "hard",
      question_text: payload.question_text,
      question_type: "short_answer",
      allows_multiple_answers: false,
      explanation: payload.explanation,
      review_status: "pending",
      publication_status: "draft",
      is_flagged: false,
      created_by_id: "66666666-6666-4666-8666-666666666666",
      submitted_by_id: "77777777-7777-4777-8777-777777777777",
      last_updated: "2026-11-10T12:00:00Z",
      options: [],
      expected_answer: payload.expected_answer,
    });

    await editManagedQuestion("admin-token", questionId, payload);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `http://localhost:8000/api/v1/admin/questions/${questionId}`,
    );
    expect(options?.method).toBe("PATCH");
    expect(JSON.parse(String(options?.body))).toEqual(payload);
  });
});
