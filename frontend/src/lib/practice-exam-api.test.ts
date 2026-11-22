import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "./practice-exam-api";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

const exam: PublishedPracticeExam = {
  id: "11111111-1111-4111-8111-111111111111",
  certification_id: "22222222-2222-4222-8222-222222222222",
  category_id: "66666666-6666-4666-8666-666666666666",
  name: "Science Practice",
  certification_name: "Computer Science",
  category_name: "Fundamentals",
  question_count: 3,
  available_question_count: 10,
};

function mockResponse(status: number, data: unknown) {
  const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response);
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("Learner published practice exams API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads only the published exam catalog with bearer auth", async () => {
    const mockFetch = mockResponse(200, { exams: [exam] });
    expect(await getPublishedPracticeExams("token")).toEqual([exam]);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/exams/catalog");
    expect(options?.method).toBe("GET");
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("honors a legitimate empty catalog", async () => {
    mockResponse(200, { exams: [] });
    expect(await getPublishedPracticeExams("token")).toEqual([]);
  });

  it("starts with an exam ID and admin-fixed count", async () => {
    const mockFetch = mockResponse(201, { attempt_id: "attempt-1" });
    await startPublishedPracticeExam("token", exam);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/exams");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({
      practice_exam_id: exam.id,
      certification_id: exam.certification_id,
      category_id: exam.category_id,
      question_count: 3,
    });
  });

  it("does not hide 409s when an admin unpublishes after listing", async () => {
    mockResponse(409, {
      detail: { code: "PRACTICE_EXAM_UNAVAILABLE" },
    });
    await expect(startPublishedPracticeExam("token", exam)).rejects.toMatchObject({
      status: 409,
    });
  });
});
