import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAvailableCategories,
  startCategoryExam,
} from "./category-api";

import type { PracticeCategory } from "@/types/category-api.types";

const category: PracticeCategory = {
  id: "11111111-1111-4111-8111-111111111111",
  certification_id: "22222222-2222-4222-8222-222222222222",
  name: "Agile Fundamentals",
  certification_name: "Agile Demo",
  available_question_count: 3,
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

describe("Category API integration", () => {
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

  it("retrieves categories with bearer authentication", async () => {
    const mockFetch = mockResponse(200, {
      categories: [category],
    });

    const result = await getAvailableCategories("test-token");

    expect(result).toEqual([category]);

    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe(
      "http://localhost:8000/api/v1/categories",
    );
    expect(options?.method).toBe("GET");
    expect(
      new Headers(options?.headers).get("Authorization"),
    ).toBe("Bearer test-token");
  });

  it("handles empty category lists", async () => {
    mockResponse(200, { categories: [] });

    const result = await getAvailableCategories("test-token");

    expect(result).toEqual([]);
  });

  it("starts an exam with the selected category", async () => {
    const exam = {
      attempt_id: "33333333-3333-4333-8333-333333333333",
      certification_id: category.certification_id,
      status: "in_progress",
      question_count: 3,
      questions: [],
    };

    const mockFetch = mockResponse(201, exam);

    const result = await startCategoryExam(
      "test-token",
      category,
      3,
    );

    expect(result.attempt_id).toBe(exam.attempt_id);

    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe(
      "http://localhost:8000/api/v1/exams",
    );
    expect(options?.method).toBe("POST");

    expect(JSON.parse(String(options?.body))).toEqual({
      certification_id: category.certification_id,
      category_id: category.id,
      question_count: 3,
    });
  });

  it.each([0, -1, 1.5, 4])(
    "rejects invalid question count %s",
    async (count) => {
      const mockFetch = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        startCategoryExam("test-token", category, count),
      ).rejects.toThrow(RangeError);

      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("handles expired authentication", async () => {
    mockResponse(401, { detail: "Unauthorized" });

    await expect(
      getAvailableCategories("expired-token"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });

  it("handles a stale category question count", async () => {
    mockResponse(409, {
      detail: {
        code: "INSUFFICIENT_QUESTIONS",
        requested: 3,
        available: 2,
      },
    });

    await expect(
      startCategoryExam("test-token", category, 3),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
    });
  });

  it("rejects a missing bearer token", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      getAvailableCategories(""),
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});