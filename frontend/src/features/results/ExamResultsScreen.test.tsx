import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamResultsScreen from "./ExamResultsScreen";
import { getExamResults } from "@/lib/exam-results";
import { ApiError } from "@/lib/api-client";
import type { ExamResultsResponse } from "@/types/exam-api.types";

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

  it("shows an error if grading is not complete or attempt_id mismatches", async () => {
    mockedGetExamResults.mockResolvedValueOnce(
      buildResultsResponse({ grading_complete: false }),
    );

    render(
      <ExamResultsScreen attemptId="attempt-123" accessToken="token-abc" />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Exam grading is not complete.",
      );
    });
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
