import { afterEach, describe, expect, it, vi } from "vitest";
import { requestQuestionChanges } from "./admin-question-api";

afterEach(() => vi.unstubAllGlobals());

describe("JHEP-207 request changes API", () => {
  it("sends an authenticated request to the existing review endpoint", async () => {
    const result = { question_id: "question/1", review_status: "pending", publication_status: "draft", review_note: "Clarify the question." };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestQuestionChanges("test-token", "question/1", "Clarify the question.")).toEqual(result);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/v1/admin/questions/question%2F1/request-changes");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init?.body))).toEqual({ review_note: "Clarify the question." });
  });
});
