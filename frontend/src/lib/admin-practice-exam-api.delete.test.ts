import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAdminPracticeExam } from "./admin-practice-exam-api";

const examId = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());

describe("JHEP-207 administrator practice exam deletion API client", () => {
  it("sends an authenticated bodyless DELETE and accepts an empty 204", async () => {
    const json = vi.fn().mockRejectedValue(new Error("No content"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 204, json } as unknown as Response);
    vi.stubGlobal("fetch", fetcher);
    await expect(deleteAdminPracticeExam("admin-token", examId)).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/api/v1/admin/practice-exams/${examId}`);
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer admin-token");
    expect(init?.body).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("preserves the backend's structured history-protection error", async () => {
    const detail = { code: "PRACTICE_EXAM_HAS_ATTEMPTS", message: "Keep it unpublished" };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 409 })));
    await expect(deleteAdminPracticeExam("admin-token", examId)).rejects.toMatchObject({ status: 409, detail });
  });

  it("does not send unauthenticated deletion requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(deleteAdminPracticeExam("", examId)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
