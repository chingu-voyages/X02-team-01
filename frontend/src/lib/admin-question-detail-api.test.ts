import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getManagedQuestion,
  retireManagedQuestion,
} from "./admin-question-api";

const questionId = "11111111-1111-4111-8111-111111111111";

function mockResponse(status: number, body: unknown) {
  const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("Admin question detail API", () => {
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

  it("retrieves one managed question with bearer authentication", async () => {
    const detail = {
      question_id: questionId,
      question_version_id: "22222222-2222-4222-8222-222222222222",
      version_number: 2,
      certification_id: "33333333-3333-4333-8333-333333333333",
      certification_name: "Agile Demo",
      category_id: "44444444-4444-4444-8444-444444444444",
      category_name: "Agile Principles",
      difficulty: "medium",
      question_text: "Which statement best describes an Agile mindset?",
      question_type: "multiple_choice",
      allows_multiple_answers: false,
      explanation: "Agile values iterative learning.",
      review_status: "approved",
      publication_status: "active",
      is_flagged: false,
      created_by_id: "55555555-5555-4555-8555-555555555555",
      submitted_by_id: "55555555-5555-4555-8555-555555555555",
      last_updated: "2026-11-09T12:00:00Z",
      options: [
        { position: 1, option_text: "Fixed plan", is_correct: false },
        { position: 2, option_text: "Iterative values", is_correct: true },
      ],
      expected_answer: null,
    };
    const mockFetch = mockResponse(200, detail);

    const result = await getManagedQuestion("admin-token", questionId);

    expect(result).toEqual(detail);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `http://localhost:8000/api/v1/admin/questions/${questionId}`,
    );
    expect(options?.method).toBe("GET");
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer admin-token",
    );
  });

  it("retires a question only after explicit confirmation payload", async () => {
    const response = {
      question_id: questionId,
      retired_version_ids: [
        "22222222-2222-4222-8222-222222222222",
      ],
      publication_status: "retired",
      already_retired: false,
    };
    const mockFetch = mockResponse(200, response);

    const result = await retireManagedQuestion("admin-token", questionId);

    expect(result).toEqual(response);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `http://localhost:8000/api/v1/admin/questions/${questionId}/retire`,
    );
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({ confirm: true });
  });

  it("surfaces forbidden retirement attempts", async () => {
    mockResponse(403, { detail: "Insufficient permissions" });

    await expect(
      retireManagedQuestion("contributor-token", questionId),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
    });
  });
});
