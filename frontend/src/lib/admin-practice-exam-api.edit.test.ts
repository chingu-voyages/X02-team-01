import { afterEach, describe, expect, it, vi } from "vitest";

import { updateAdminPracticeExam } from "./admin-practice-exam-api";

const examId = "11111111-1111-4111-8111-111111111111";
const payload = {
  name: "Science Practice",
  certification_id: "cert-id",
  category_id: "category-id",
  question_count: 15,
};

function stubResponse(status: number, json: unknown) {
  const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  } as Response);
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("JHEP-107 administrator configuration API", () => {
  it("updates the existing exam via PUT with the admin token and configuration only", async () => {
    const saved = { ...payload, id: examId, status: "draft" };
    const fetcher = stubResponse(200, saved);
    await expect(updateAdminPracticeExam("admin-token", examId, payload)).resolves.toEqual(saved);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/api/v1/admin/practice-exams/${examId}`);
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin-token");
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });

  it("preserves the backend conflict message", async () => {
    const detail = "Unpublish the practice exam before editing";
    stubResponse(409, { detail });
    await expect(updateAdminPracticeExam("admin-token", examId, payload)).rejects.toMatchObject({ status: 409, detail, message: detail });
  });

  it("refuses a request without authentication", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(updateAdminPracticeExam("", examId, payload)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
