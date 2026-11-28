import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import QuestionReviewPage from "./page";
import { attemptId, versionId } from "@/lib/exam-question-review.fixture";

const { useParams, useDemoSession } = vi.hoisted(() => ({ useParams: vi.fn(), useDemoSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession }));
vi.mock("@/features/exam-review/CompletedQuestionReviewScreen", () => ({
  default: ({ attemptId, questionVersionId, accessToken }: { attemptId: string; questionVersionId: string; accessToken: string }) => <div data-testid="question-review" data-attempt={attemptId} data-version={questionVersionId} data-token={accessToken} />,
}));
beforeEach(() => { vi.clearAllMocks(); useParams.mockReturnValue({ attemptId, questionVersionId: versionId }); useDemoSession.mockReturnValue({ ready: true, token: "token" }); });
afterEach(cleanup);

describe("individual question review page", () => {
  it("passes the authenticated attempt and pinned version", () => {
    render(<QuestionReviewPage />);
    const detail = screen.getByTestId("question-review");
    expect(detail.getAttribute("data-attempt")).toBe(attemptId);
    expect(detail.getAttribute("data-version")).toBe(versionId);
    expect(detail.getAttribute("data-token")).toBe("token");
  });
  it.each([{ ready: false, token: null }, { ready: true, token: null }])("withholds private content without a ready session", (session) => {
    useDemoSession.mockReturnValue(session); render(<QuestionReviewPage />);
    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(screen.queryByTestId("question-review")).toBeNull();
  });
  it("rejects malformed version with safe return to question list", () => {
    useParams.mockReturnValue({ attemptId, questionVersionId: "invalid" }); render(<QuestionReviewPage />);
    expect(screen.getByRole("alert").textContent).toBe("Invalid question review link.");
    expect(screen.getByRole("link", { name: "Back to questions" }).getAttribute("href")).toBe(`/exams/${attemptId}/review`);
    expect(screen.queryByTestId("question-review")).toBeNull();
  });
  it("rejects malformed attempt with safe exit", () => {
    useParams.mockReturnValue({ attemptId: "invalid", questionVersionId: versionId }); render(<QuestionReviewPage />);
    expect(screen.getByRole("link", { name: "Back to practice exams" }).getAttribute("href")).toBe("/categories");
    expect(screen.queryByTestId("question-review")).toBeNull();
  });
});
