import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamResultsScreen from "./ExamResultsScreen";
import { getExamResults } from "@/lib/exam-results";
import { ApiError } from "@/lib/api-client";
import type { ExamResultsResponse, QuestionResult } from "@/types/exam-api.types";

vi.mock("@/lib/exam-results", () => ({
  getExamResults: vi.fn(),
}));

const mockLogout = vi.fn();
vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    logout: mockLogout,
  }),
}));

const mockedGetExamResults = vi.mocked(getExamResults);

function buildResultsResponse(
  overrides: Partial<ExamResultsResponse> = {},
): ExamResultsResponse {
  return {
    attempt_id: "attempt-123",
    status: "submitted",
    correct_count: 23,
    incorrect_count: 2,
    score_percent: 92,
    passing_score_percent: 85,
    passed: true,
    grading_complete: true,
    ...overrides,
  };
}

const writtenQuestion: QuestionResult = {
  attempt_id: "attempt-123",
  question_version_id: "written-question-1",
  position: 2,
  question_text: "Explain the difference.",
  response_type: "short_answer",
  outcome: "ungraded",
  status: "pending_manual_grading",
  points_earned: 0,
  max_points: 2,
  feedback: null,
  learner_response: "They differ in scope.",
};

describe("ExamResultsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading indicator and renders ResultCard when results load", async () => {
    mockedGetExamResults.mockResolvedValueOnce(buildResultsResponse());

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Loading exam results...",
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Practice exam complete" }),
      ).toBeTruthy();
    });

    expect(mockedGetExamResults).toHaveBeenCalledWith(
      "attempt-123",
      "token-abc",
    );
    expect(screen.getByText("Pass")).toBeTruthy();
  });

  it("displays an error alert and retries loading when Retry is clicked", async () => {
    const user = userEvent.setup();
    mockedGetExamResults
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce(buildResultsResponse());

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Network failure");
    });

    await user.click(
      screen.getByRole("button", { name: "Retry loading results" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Practice exam complete" }),
      ).toBeTruthy();
    });
    expect(mockedGetExamResults).toHaveBeenCalledTimes(2);
  });

  it("rejects results belonging to a different attempt", async () => {
    mockedGetExamResults.mockResolvedValueOnce(
      buildResultsResponse({ attempt_id: "different-attempt" }),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Unexpected exam result received.",
    );
  });

  it("shows pending written responses instead of a final pass or fail", async () => {
    mockedGetExamResults.mockResolvedValueOnce(
      buildResultsResponse({
        correct_count: 1,
        incorrect_count: 0,
        score_percent: 50,
        passed: null,
        grading_complete: false,
        pending_manual_grading_count: 1,
        questions: [writtenQuestion],
      }),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Written responses awaiting review",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Awaiting review")).toBeTruthy();
    expect(screen.getByText("Provisional score: 50% (not final)")).toBeTruthy();
    expect(screen.getByText("Question breakdown")).toBeTruthy();
    expect(screen.getByText("Awaiting manual review")).toBeTruthy();
    expect(screen.getByText(/They differ in scope./)).toBeTruthy();
    expect(screen.queryByText("Pass")).toBeNull();
    expect(screen.queryByText("Fail")).toBeNull();
    expect(screen.queryByText("Not passed")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the completed result and reviewer feedback after manual grading", async () => {
    mockedGetExamResults.mockResolvedValueOnce(
      buildResultsResponse({
        correct_count: 0,
        incorrect_count: 0,
        score_percent: 100,
        passed: true,
        grading_complete: true,
        pending_manual_grading_count: 0,
        questions: [
          {
            ...writtenQuestion,
            outcome: "manually_graded",
            status: "graded",
            points_earned: 2,
            feedback: "Clear explanation.",
          },
        ],
      }),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    expect(
      await screen.findByRole("heading", { name: "Practice exam complete" }),
    ).toBeTruthy();
    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.getByText("Score: 2/2")).toBeTruthy();
    expect(screen.getByText("Feedback: Clear explanation.")).toBeTruthy();
    expect(screen.queryByText("Awaiting review")).toBeNull();
  });

  it("does not estimate missing correct answers from weighted manual grades", async () => {
    mockedGetExamResults.mockResolvedValueOnce(
      buildResultsResponse({
        correct_count: 1,
        incorrect_count: 0,
        score_percent: 33,
        passed: false,
        questions: [
          {
            ...writtenQuestion,
            question_version_id: "multiple-choice-1",
            position: 1,
            response_type: "multiple_choice",
            outcome: "correct",
            status: "graded",
            points_earned: 1,
            max_points: 1,
            learner_response: null,
          },
          {
            ...writtenQuestion,
            outcome: "manually_graded",
            status: "graded",
          },
        ],
      }),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    expect(await screen.findByText("Fail")).toBeTruthy();
    expect(screen.queryByText(/away from the pass mark/)).toBeNull();
    expect(screen.getByText("Score: 0/2")).toBeTruthy();
  });

  it("calls logout when the API responds with 401 Unauthorized", async () => {
    mockedGetExamResults.mockRejectedValueOnce(
      new ApiError(401, "Unauthorized"),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });
});
