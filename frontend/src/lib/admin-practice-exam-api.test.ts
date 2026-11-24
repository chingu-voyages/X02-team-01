import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAdminPracticeExam,
  getAdminPracticeExam,
  getAdminPracticeExams,
  practiceExamNotReadyDetail,
  setAdminPracticeExamPublication,
} from "./admin-practice-exam-api";

const examId = "11111111-1111-4111-8111-111111111111";

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

describe("JHEP-126 administrator practice exam API", () => {
  it("lists all exam statuses with the admin bearer token", async () => {
    const fetcher = stubResponse(200, { items: [{ id: examId }], count: 1 });
    await expect(getAdminPracticeExams("admin-token")).resolves.toEqual([{ id: examId }]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/v1/admin/practice-exams");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin-token");
  });

  it("gets one practice exam for up-to-date readiness", async () => {
    const fetcher = stubResponse(200, { id: examId });
    await getAdminPracticeExam("admin-token", examId);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/admin/practice-exams/${examId}`);
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });

  it("creates a configured draft and never includes a publication flag", async () => {
    const fetcher = stubResponse(201, { id: examId, status: "draft" });
    const payload = {
      name: "Science Practice",
      certification_id: "cert-id",
      category_id: "category-id",
      question_count: 15,
    };
    await createAdminPracticeExam("admin-token", payload);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/v1/admin/practice-exams");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });

  it.each([true, false])("sets publication to %s through PATCH", async (published) => {
    const fetcher = stubResponse(200, { id: examId });
    await setAdminPracticeExamPublication("admin-token", examId, published);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/api/v1/admin/practice-exams/${examId}/publication`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ is_published: published });
  });

  it("keeps the server's coded readiness conflict accessible", async () => {
    const detail = {
      code: "PRACTICE_EXAM_NOT_READY",
      message: "Resolve requirements",
      readiness: {
        ready: false,
        required_question_count: 15,
        eligible_question_count: 2,
        issues: [{ code: "INSUFFICIENT_PUBLISHED_QUESTIONS", message: "Need 15" }],
      },
    };
    stubResponse(409, { detail });
    await expect(setAdminPracticeExamPublication("admin-token", examId, true))
      .rejects.toMatchObject({ status: 409, detail });
    expect(practiceExamNotReadyDetail(detail)).toEqual(detail);
    expect(practiceExamNotReadyDetail({ code: "OTHER" })).toBeNull();
  });

  it("cannot invoke admin endpoints without a bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(getAdminPracticeExams("")).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
