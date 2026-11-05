import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getExam, submitAnswer } from "./exam-api";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Exam API integration", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads an attempt with bearer authentication", async () => {
    const attempt = {
      attempt_id: "4711",
      questions: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, attempt));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getExam("4711", "test-token");

    expect(result.attempt_id).toBe("4711");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/exams/4711");
    expect(options?.method).toBe("GET");
    expect(options?.headers instanceof Headers).toBe(true);
    expect(
      (options?.headers as Headers).get("Authorization"),
    ).toBe("Bearer test-token");
  });

  it("submits an answer to the locked submit route", async () => {
    const feedback = {
      question_version_id: "v-1",
      is_submitted: true,
      question_submitted_at: "2026-11-05T15:00:00Z",
      feedback_released: true,
      is_correct: false,
      correct_option_ids: ["o-2"],
      explanation: "Choice B is correct.",
    };

    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, feedback));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitAnswer(
      "attempt-1",
      "version-1",
      { selected_option_ids: ["o-3"], text_response: null },
      "test-token",
    );

    expect(result.is_submitted).toBe(true);
    expect(result.feedback_released).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.example.com/exams/attempt-1/responses/version-1/submit",
    );
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({
      selected_option_ids: ["o-3"],
      text_response: null,
    });
  });

  it("sends short-answer responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer(
      "attempt-1",
      "version-2",
      { selected_option_ids: null, text_response: "Maximizing value" },
      "test-token",
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      selected_option_ids: null,
      text_response: "Maximizing value",
    });
  });

  it("surfaces API errors instead of swallowing them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(409, {})));

    await expect(
      getExam("attempt-locked", "test-token"),
    ).rejects.toMatchObject({ status: 409 });
  });
});
