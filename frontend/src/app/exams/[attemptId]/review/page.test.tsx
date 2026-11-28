import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ExamReviewPage from "./page";

const { useParams, useDemoSession } = vi.hoisted(() => ({ useParams: vi.fn(), useDemoSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession }));
vi.mock("@/features/exam-review/ExamReviewScreen", () => ({
  default: ({ attemptId, accessToken }: { attemptId: string; accessToken: string }) => (
    <div data-testid="review-screen" data-attempt={attemptId} data-token={accessToken} />
  ),
}));
const attemptId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  useParams.mockReturnValue({ attemptId });
  useDemoSession.mockReturnValue({ ready: true, token: "test-token" });
});
afterEach(cleanup);

describe("ExamReviewPage", () => {
  it("passes the exact authenticated attempt to the review screen", () => {
    render(<ExamReviewPage />);
    const review = screen.getByTestId("review-screen");
    expect(review.getAttribute("data-attempt")).toBe(attemptId);
    expect(review.getAttribute("data-token")).toBe("test-token");
  });

  it.each([{ ready: false, token: null }, { ready: true, token: null }])("does not mount private review content without a ready session", (session) => {
    useDemoSession.mockReturnValue(session);
    render(<ExamReviewPage />);
    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(screen.queryByTestId("review-screen")).toBeNull();
  });

  it("rejects a malformed attempt and offers a safe exit", () => {
    useParams.mockReturnValue({ attemptId: "bad-id" });
    render(<ExamReviewPage />);
    expect(screen.getByRole("alert").textContent).toBe("Invalid exam attempt ID.");
    expect(screen.getByRole("link", { name: "Back to practice exams" }).getAttribute("href")).toBe("/categories");
    expect(screen.queryByTestId("review-screen")).toBeNull();
  });
});
