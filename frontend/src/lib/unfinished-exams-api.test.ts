import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import { getUnfinishedExamAttempts, type UnfinishedExam } from "./unfinished-exams-api";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const attempt: UnfinishedExam = {
  attempt_id: "11111111-1111-4111-8111-111111111111",
  practice_exam_id: "22222222-2222-4222-8222-222222222222",
  name: "Computer Science", certification_name: "CS", category_name: "Fundamentals",
  question_count: 3, submitted_count: 1, current_position: 2, started_at: "2026-11-27T20:00:00Z",
};
beforeEach(() => vi.resetAllMocks());

describe("unfinished exam discovery API", () => {
  it("loads the authenticated list without creating a new attempt", async () => {
    request.mockResolvedValue({ attempts: [attempt] });
    expect(await getUnfinishedExamAttempts("token")).toEqual([attempt]);
    expect(request).toHaveBeenCalledExactlyOnceWith("/exams/unfinished", "token", { method: "GET", cache: "no-store" });
  });
  it("accepts a real empty list and legacy attempts without guessing a catalog identity", async () => {
    request.mockResolvedValueOnce({ attempts: [] }).mockResolvedValueOnce({ attempts: [{ ...attempt, practice_exam_id: null, name: null, category_name: null }] });
    expect(await getUnfinishedExamAttempts("token")).toEqual([]);
    expect((await getUnfinishedExamAttempts("token"))[0].practice_exam_id).toBeNull();
  });
  it.each([
    null, {}, { attempts: null }, { attempts: [{}] },
    { attempts: [{ ...attempt, attempt_id: "//evil.test" }] },
    { attempts: [{ ...attempt, practice_exam_id: "bad" }] },
    { attempts: [{ ...attempt, submitted_count: 4 }] },
    { attempts: [{ ...attempt, current_position: 0 }] },
    { attempts: [{ ...attempt, current_position: 4 }] },
    { attempts: [{ ...attempt, question_count: 0 }] },
    { attempts: [{ ...attempt, started_at: "not-a-date" }] },
    { attempts: [attempt, attempt] },
  ])("rejects malformed or unsafe summaries (%j)", async (payload) => {
    request.mockResolvedValue(payload);
    await expect(getUnfinishedExamAttempts("token")).rejects.toThrow("Unable to read unfinished exams");
  });
  it("propagates request errors instead of returning an empty list", async () => {
    const error = new Error("Offline");
    request.mockRejectedValue(error);
    await expect(getUnfinishedExamAttempts("token")).rejects.toBe(error);
  });
});
