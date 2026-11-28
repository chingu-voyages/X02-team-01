import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ExamResultsPage from "@/app/exams/[attemptId]/results/page";
import ResultNextSteps from "./ResultNextSteps";
import { getExamResults } from "@/lib/exam-results";
import { ApiError } from "@/lib/api-client";
import type { ExamResultsResponse } from "@/types/exam-api.types";

const { logout, useParams, useDemoSession } = vi.hoisted(() => ({
  logout: vi.fn(),
  useParams: vi.fn(),
  useDemoSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: () => ({ logout }),
  useDemoSession,
}));
vi.mock("@/lib/exam-results", () => ({ getExamResults: vi.fn() }));
const load = vi.mocked(getExamResults);
const attemptId = "11111111-1111-4111-8111-111111111111";
const reviewHref = `/exams/${attemptId}/review`;
const response: ExamResultsResponse = {
  attempt_id: attemptId,
  status: "submitted",
  correct_count: 1,
  incorrect_count: 1,
  score_percent: 50,
  passing_score_percent: 70,
  passed: false,
  grading_complete: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  useParams.mockReturnValue({ attemptId });
  useDemoSession.mockReturnValue({ ready: true, token: "token" });
});
afterEach(cleanup);

function show() {
  return render(<ExamResultsPage />);
}

describe("completed exam review entry", () => {
  it.each([true, false])("links to the same submitted attempt when grading_complete=%s", async (gradingComplete) => {
    load.mockResolvedValueOnce({ ...response, grading_complete: gradingComplete, passed: gradingComplete ? false : null, pending_manual_grading_count: gradingComplete ? 0 : 1 });
    show();
    expect(screen.queryByRole("link", { name: "Review Answers" })).toBeNull();
    const link = await screen.findByRole("link", { name: "Review Answers" });
    expect(link.getAttribute("href")).toBe(reviewHref);
    expect(screen.getByRole("link", { name: "Back to practice exams" }).getAttribute("href")).toBe("/categories");
  });

  it.each([404, 409, 500])("does not expose review on failed results: HTTP %i", async (status) => {
    load.mockRejectedValueOnce(new ApiError(status, "Results unavailable"));
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review Answers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review Answers" })).toBeNull();
  });

  it("removes stale results and the review link immediately when the session changes", async () => {
    load.mockResolvedValueOnce(response).mockImplementationOnce(() => new Promise(() => {}));
    const view = show();
    expect(await screen.findByRole("link", { name: "Review Answers" })).toBeTruthy();
    useDemoSession.mockReturnValue({ ready: true, token: "other-token" });
    view.rerender(<ExamResultsPage />);
    expect(screen.queryByRole("link", { name: "Review Answers" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading exam results...");
  });

  it("hides the action when there is no destination or handler", () => {
    render(<ResultNextSteps />);
    expect(screen.queryByRole("link", { name: "Review Answers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review Answers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to practice exams" })).toBeTruthy();
  });
});
