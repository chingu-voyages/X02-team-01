import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getGradingPermissions,
  getPendingManualResponses,
  getWrittenResponseDetail,
  getWrittenResponseHistory,
  submitManualGrade,
} from "./manual-grading-api";
import { ApiError } from "./api-client";

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionVersionId = "22222222-2222-4222-8222-222222222222";
const responsePath = `/api/v1/admin/grading/responses/${attemptId}/${questionVersionId}`;

function mockOk(data: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("manual grading API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets the caller's permitted response types", async () => {
    const permissions = { short_answer: true, essay: false };
    const fetchMock = mockOk(permissions);

    await expect(getGradingPermissions("token")).resolves.toEqual(
      permissions,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/grading/permissions",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("filters the pending queue by response type", async () => {
    const queue = { items: [], count: 0 };
    const fetchMock = mockOk(queue);

    await expect(
      getPendingManualResponses("token", "essay"),
    ).resolves.toEqual(queue);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/grading/pending?response_type=essay",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("loads detail and history with encoded identifiers", async () => {
    const detail = { attempt_id: attemptId };
    const detailFetch = mockOk(detail);
    await expect(
      getWrittenResponseDetail("token", attemptId, questionVersionId),
    ).resolves.toEqual(detail);
    expect(detailFetch).toHaveBeenCalledWith(
      responsePath,
      expect.objectContaining({ method: "GET" }),
    );

    const history = { items: [], count: 0 };
    const historyFetch = mockOk(history);
    await expect(
      getWrittenResponseHistory("token", attemptId, questionVersionId),
    ).resolves.toEqual(history);
    expect(historyFetch).toHaveBeenCalledWith(
      `${responsePath}/history`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("submits a human score and optional feedback", async () => {
    const submitted = { outcome: "manually_graded", score: 2 };
    const fetchMock = mockOk(submitted);

    await expect(
      submitManualGrade("token", attemptId, questionVersionId, 2, "Good"),
    ).resolves.toEqual(submitted);
    expect(fetchMock).toHaveBeenCalledWith(
      `${responsePath}/grade`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ score: 2, feedback: "Good" }),
      }),
    );
  });

  it("preserves authorization errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGradingPermissions("token")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
    });
  });

  it("rejects a missing token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitManualGrade("", attemptId, questionVersionId, 1, null),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
