import { afterEach, describe, expect, it, vi } from "vitest";
import { setQuestionFlag } from "./exam-api";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("JHEP-104 flag API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])("sets an explicit flag value of %s", async (flagged) => {
    const saved = {
      attempt_id: "attempt-1",
      question_version_id: "version-1",
      flagged_for_review: flagged,
    };
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, saved));
    vi.stubGlobal("fetch", fetchMock);

    await expect(setQuestionFlag("attempt-1", "version-1", flagged, "token"))
      .resolves.toEqual(saved);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/exams/attempt-1/questions/version-1/flag");
    expect(options.method).toBe("PUT");
    expect(options.headers.get("Authorization")).toBe("Bearer token");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(options.body))).toEqual({ flagged_for_review: flagged });
  });

  it("encodes both path parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await setQuestionFlag("attempt/1", "version?1", true, "token");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/exams/attempt%2F1/questions/version%3F1/flag",
    );
  });

  it.each([401, 404, 409, 500])("preserves API error %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(status, {})));
    await expect(setQuestionFlag("attempt-1", "version-1", true, "token"))
      .rejects.toMatchObject({ status });
  });
});
