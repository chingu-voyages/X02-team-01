import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { apiRequest } from "./api-client";

describe("API conflict handling", () => {
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

  it("preserves an existing attempt ID from a 409", async () => {
    const attemptId =
      "11111111-1111-4111-8111-111111111111";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          detail: {
            code: "ATTEMPT_IN_PROGRESS",
            attempt_id: attemptId,
          },
        }),
      }),
    );

    await expect(
      apiRequest("/exams", "test-token", {
        method: "POST",
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      detail: {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: attemptId,
      },
    });
  });

  it("handles a conflict with invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => {
          throw new SyntaxError("Invalid JSON");
        },
      }),
    );

    await expect(
      apiRequest("/exams", "test-token"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      detail: null,
    });
  });
});
