import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { submitExam } from "./exam-submission";

const attemptId = "11111111-1111-4111-8111-111111111111";

const submissionResponse = {
  attempt_id: attemptId,
  status: "submitted",
  question_count: 3,
  answered_count: 3,
  unanswered_count: 0,
  submitted_at: "2026-11-04T20:00:00Z",
  results_url: `/api/v1/exams/${attemptId}/results`,
};

function mockResponse(status: number, body: unknown) {
  const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("Final exam submission API", () => {
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

  it("submits an authenticated exam", async () => {
    const mockFetch = mockResponse(200, submissionResponse);

    const result = await submitExam(
      attemptId,
      "test-token",
    );

    expect(result).toEqual(submissionResponse);

    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe(
      `http://localhost:8000/api/v1/exams/${attemptId}/submit`,
    );

    expect(options?.method).toBe("POST");
    expect(options?.cache).toBe("no-store");
    expect(options?.body).toBeUndefined();

    expect(
      new Headers(options?.headers).get("Authorization"),
    ).toBe("Bearer test-token");
  });

  it.each([401, 404, 409, 500])(
    "handles HTTP %i",
    async (status) => {
      mockResponse(status, { detail: "Request failed" });

      await expect(
        submitExam(attemptId, "test-token"),
      ).rejects.toMatchObject({
        name: "ApiError",
        status,
      });
    },
  );

  it("rejects missing authentication", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      submitExam(attemptId, ""),
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
