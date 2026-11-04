import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getExamResults } from "./exam-results";
import { ApiError } from "./api-client";

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
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResults,
    } as Response);

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
        cache: "no-store",
      }),
    );

    const [, options] = mockFetch.mock.calls[0];

    expect(
      new Headers(options?.headers).get("Authorization"),
    ).toBe("Bearer test-token");
  });

  it.each([401, 404, 409, 500])(
    "handles HTTP %i errors",
    async (status) => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status,
      } as Response);

      vi.stubGlobal("fetch", mockFetch);

      await expect(
        getExamResults(attemptId, "test-token"),
      ).rejects.toMatchObject({
        name: "ApiError",
        status,
      });
    },
  );

  it("returns an ApiError for an expired token", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    vi.stubGlobal("fetch", mockFetch);

    await expect(
      getExamResults(attemptId, "expired-token"),
    ).rejects.toBeInstanceOf(ApiError);

    await expect(
      getExamResults(attemptId, "expired-token"),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a missing bearer token", async () => {
    const mockFetch = vi.fn<typeof fetch>();

    vi.stubGlobal("fetch", mockFetch);

    await expect(
      getExamResults(attemptId, ""),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects requests when the API URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    const mockFetch = vi.fn<typeof fetch>();

    vi.stubGlobal("fetch", mockFetch);

    await expect(
      getExamResults(attemptId, "test-token"),
    ).rejects.toThrow(
      "NEXT_PUBLIC_API_URL is not configured",
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
