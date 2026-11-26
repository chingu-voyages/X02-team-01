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
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ManualReviewScreen from "./ManualReviewScreen";
import { useDemoSession } from "@/features/auth/AuthProvider";
import {
  getWrittenResponseDetail,
  submitManualGrade,
} from "@/lib/manual-grading-api";
import type {
  WrittenResponseDetail,
} from "@/types/exam-api.types";

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionVersionId = "22222222-2222-4222-8222-222222222222";

const detail: WrittenResponseDetail = {
  attempt_id: attemptId,
  question_version_id: questionVersionId,
  response_type: "short_answer",
  question_text: "Explain the difference.",
  learner_response: "They differ in scope.",
  expected_answer: "One is narrower.",
  max_points: 2,
  criteria_markdown: null,
  rubric: [
    { position: 1, name: "Accuracy", points: 2 },
  ],
  current_grade: null,
  history: [],
  provisional_ai_feedback: {
    available: true,
    label: "Provisional AI feedback — context only, not a final grade",
    content: "Consider adding an example.",
  },
};

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: vi.fn(),
}));

vi.mock("@/lib/manual-grading-api", () => ({
  getWrittenResponseDetail: vi.fn(),
  submitManualGrade: vi.fn(),
}));

describe("ManualReviewScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDemoSession).mockReturnValue({
      token: "token",
      role: "contributor",
      ready: true,
      handleError: vi.fn(),
    } as ReturnType<typeof useDemoSession>);
    vi.mocked(getWrittenResponseDetail).mockResolvedValue(detail);
    vi.mocked(submitManualGrade).mockResolvedValue({
      attempt_id: attemptId,
      question_version_id: questionVersionId,
      outcome: "manually_graded",
      score: 2,
      max_points: 2,
      feedback: "Clear answer",
      grader_role: "contributor",
      action: "graded",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the saved response, rubric and labelled AI context", async () => {
    render(
      <ManualReviewScreen
        attemptId={attemptId}
        questionVersionId={questionVersionId}
      />,
    );

    expect(await screen.findByText("They differ in scope.")).toBeTruthy();
    expect(screen.getByText("One is narrower.")).toBeTruthy();
    expect(
      screen.getByText(
        "Provisional AI feedback — context only, not a final grade",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Consider adding an example.")).toBeTruthy();
  });

  it("rejects an out-of-range score before calling the API", async () => {
    render(
      <ManualReviewScreen
        attemptId={attemptId}
        questionVersionId={questionVersionId}
      />,
    );
    await screen.findByLabelText("Score (0–2)");

    await userEvent.type(screen.getByLabelText("Score (0–2)"), "3");
    await userEvent.click(
      screen.getByRole("button", { name: "Submit final grade" }),
    );

    expect(
      screen.getByText("Enter a whole number from 0 to 2."),
    ).toBeTruthy();
    expect(submitManualGrade).not.toHaveBeenCalled();
  });

  it("records a final grade and refreshes the detail", async () => {
    render(
      <ManualReviewScreen
        attemptId={attemptId}
        questionVersionId={questionVersionId}
      />,
    );
    await screen.findByLabelText("Score (0–2)");

    await userEvent.type(screen.getByLabelText("Score (0–2)"), "2");
    await userEvent.type(
      screen.getByLabelText("Feedback (optional)"),
      "Clear answer",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Submit final grade" }),
    );

    await waitFor(() => {
      expect(submitManualGrade).toHaveBeenCalledWith(
        "token",
        attemptId,
        questionVersionId,
        2,
        "Clear answer",
      );
    });
    expect(
      await screen.findByText("Final grade recorded: 2/2."),
    ).toBeTruthy();
    expect(getWrittenResponseDetail).toHaveBeenCalledTimes(2);
  });

  it("shows history when grades have been recorded", async () => {
    vi.mocked(getWrittenResponseDetail).mockResolvedValue({
      ...detail,
      current_grade: {
        outcome: "manually_graded",
        points_earned: 1,
        feedback: null,
        graded_by_id: null,
        grader_role: "administrator",
        max_points: 2,
        graded_at: "2026-11-26T10:00:00Z",
      },
      history: [
        {
          grader_role: "administrator",
          action: "graded",
          score: 1,
          max_points: 2,
          feedback: null,
          created_at: "2026-11-26T10:00:00Z",
        },
      ],
    });

    render(
      <ManualReviewScreen
        attemptId={attemptId}
        questionVersionId={questionVersionId}
      />,
    );

    expect(await screen.findByText("Grading history")).toBeTruthy();
    expect(screen.getByText("administrator")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
  });
});
