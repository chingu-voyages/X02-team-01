import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getExamResults } from "./exam-results";

const attemptId = "11111111-1111-4111-8111-111111111111";

const mockResults = {
  attempt_id: attemptId,
  status: "submitted",
  correct_count: 2,
  incorrect_count: 1,
  score_percent: 66.6667,
  passing_score_percent: 65,
  passed: true,
  grading_complete: true,
};

describe("getExamResults", () => {
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

  it("retrieves results for an authenticated attempt", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResults,
    });

    vi.stubGlobal("fetch", mockFetch);

    const results = await getExamResults(
      attemptId,
      "test-token",
    );

    expect(results).toEqual(mockResults);

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:8000/api/v1/exams/${attemptId}/results`,
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
        },
        cache: "no-store",
      }),
    );
  });

  it.each([401, 404, 409])(
    "handles HTTP %i errors",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
        }),
      );

      await expect(
        getExamResults(attemptId, "test-token"),
      ).rejects.toThrow(
        `Failed to retrieve exam results (${status})`,
      );
    },
  );
});
