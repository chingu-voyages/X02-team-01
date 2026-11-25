import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";

import ExamResultsScreen from "./ExamResultsScreen";
import { getExamResults } from "@/lib/exam-results";
import { useAuth } from "@/features/auth/AuthProvider";
import type {
  ExamResultsResponse,
} from "@/types/exam-api.types";

vi.mock("@/lib/exam-results", () => ({
  getExamResults: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

const results: ExamResultsResponse = {
  attempt_id: "11111111-1111-4111-8111-111111111111",
  status: "submitted",
  correct_count: 1,
  incorrect_count: 0,
  score_percent: 50,
  passing_score_percent: 70,
  passed: null,
  grading_complete: false,
  pending_manual_grading_count: 1,
  questions: [
    {
      attempt_id: "11111111-1111-4111-8111-111111111111",
      question_version_id: "22222222-2222-4222-8222-222222222222",
      position: 2,
      question_text: "Explain the difference.",
      response_type: "short_answer",
      outcome: "ungraded",
      status: "pending_manual_grading",
      points_earned: 0,
      max_points: 2,
      feedback: null,
      learner_response: "They differ in scope.",
    },
  ],
};

describe("ExamResultsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      token: "token",
      role: "learner",
      ready: true,
      setToken: vi.fn(),
      logout: vi.fn(),
    } as ReturnType<typeof useAuth>);
    vi.mocked(getExamResults).mockResolvedValue(results);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a pending review instead of treating an incomplete exam as failed", async () => {
    render(
      <ExamResultsScreen
        attemptId={results.attempt_id}
        accessToken="token"
      />,
    );

    expect(
      await screen.findByText("Written responses awaiting review"),
    ).toBeTruthy();
    expect(screen.getByText("Awaiting review")).toBeTruthy();
    expect(screen.getByText("Question breakdown")).toBeTruthy();
    expect(screen.getByText("Awaiting manual review")).toBeTruthy();
    expect(screen.getByText(/They differ in scope./)).toBeTruthy();
    expect(screen.queryByText("Not passed")).toBeNull();
  });

  it("shows final scores once grading is complete", async () => {
    vi.mocked(getExamResults).mockResolvedValue({
      ...results,
      grading_complete: true,
      pending_manual_grading_count: 0,
      passed: true,
      questions: [],
    });

    render(
      <ExamResultsScreen
        attemptId={results.attempt_id}
        accessToken="token"
      />,
    );

    expect(await screen.findByText("Practice exam complete")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
  });
});
