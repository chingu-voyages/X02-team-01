import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { ApiError } from "@/lib/api-client";
import type { ExamAttempt, QuestionFlagSaved } from "@/types/exam-api.types";
import ExamCard from "./ExamCard";
import ExamSidebar from "./ExamSidebar";

const { handleError, replace } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ ready: true, token: "test-token", handleError }),
}));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), setQuestionFlag: vi.fn(), submitAnswer: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));

const attemptId = "attempt-1";

function makeAttempt(): ExamAttempt {
  return {
    attempt_id: attemptId, certification_id: "cert-1", status: "in_progress",
    question_count: 2, current_position: 1,
    questions: [1, 2].map((position) => ({
      id: `question-${position}`, position,
      question_text: `Explain concept ${position}`, question_type: "short_answer",
      allows_multiple_answers: false, difficulty: "easy", options: [], images: [],
      flagged_for_review: false,
    })),
  };
}

function savedFlag(questionId: string, flagged: boolean): QuestionFlagSaved {
  return { attempt_id: attemptId, question_version_id: questionId, flagged_for_review: flagged };
}
function navigator() {
  return within(screen.getByRole("complementary", { name: "Question navigation sidebar" }));
}
async function loadCard() {
  render(<ExamCard attemptId={attemptId} />);
  await screen.findByRole("heading", { name: "Explain concept 1" });
}
function flagButton(flagged = false) {
  return screen.getByRole("button", { name: flagged ? "Flagged for Review" : "Flag for Review" });
}
async function expectFlagged(flagged: boolean) {
  const button = await screen.findByRole("button", { name: flagged ? "Flagged for Review" : "Flag for Review" });
  expect(button).toHaveAttribute("aria-pressed", String(flagged));
}

describe("JHEP-104 exam flag interface", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getExam).mockResolvedValue(makeAttempt());
    vi.mocked(setQuestionFlag).mockImplementation(async (_attempt, question, flag) => savedFlag(question, flag));
  });
  afterEach(cleanup);

  it("flags, navigates and unflags without losing a draft or submitting an answer", async () => {
    const user = userEvent.setup();
    await loadCard();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "My draft");
    flagButton().focus();
    await user.keyboard("{Enter}");
    await expectFlagged(true);
    expect(setQuestionFlag).toHaveBeenCalledExactlyOnceWith(attemptId, "question-1", true, "test-token");
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" })).toHaveAttribute("aria-current", "step");
    await user.click(navigator().getByRole("button", { name: "Question 2" }));
    expect(flagButton()).toBeEnabled();
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" })).not.toHaveAttribute("aria-current");
    await user.click(navigator().getByRole("button", { name: "Question 1, flagged for review" }));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("My draft");
    await user.click(flagButton(true));
    await expectFlagged(false);
    expect(navigator().getByRole("button", { name: "Question 1" })).toHaveAttribute("aria-current", "step");
    expect(setQuestionFlag).toHaveBeenLastCalledWith(attemptId, "question-1", false, "test-token");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(navigator().getByText("Submitted answers: 0 / 2")).toBeInTheDocument();
  });

  it("shows saved flags on load and allows flagging a locked submitted answer", async () => {
    const data = makeAttempt();
    data.questions[0].flagged_for_review = true;
    data.questions[0].response = {
      question_version_id: "question-1", selected_option_ids: null, text_response: "Locked answer",
      is_submitted: true, answered_at: "2026-11-23T00:00:00Z",
    };
    vi.mocked(getExam).mockResolvedValue(data);
    const user = userEvent.setup();
    await loadCard();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("Locked answer");
    await user.click(flagButton(true));
    await expectFlagged(false);
    await user.click(flagButton());
    await expectFlagged(true);
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    expect(navigator().getByText("Submitted answers: 1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Correct answer.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer.", { exact: true })).not.toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("disables duplicate flag and answer submission actions while saving, but allows navigation", async () => {
    let resolveFlag!: (value: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementation(() => new Promise((resolve) => { resolveFlag = resolve; }));
    const user = userEvent.setup();
    await loadCard();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "Draft");
    await user.click(flagButton());
    expect(flagButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    expect(screen.getByText("Saving review flag...")).toBeInTheDocument();
    await user.click(flagButton());
    expect(setQuestionFlag).toHaveBeenCalledTimes(1);
    await user.click(navigator().getByRole("button", { name: "Question 2" }));
    await act(async () => resolveFlag(savedFlag("question-1", true)));
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" })).toBeEnabled();
    expect(flagButton()).toBeEnabled();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("shows an accessible save error, keeps the old flag and allows retry", async () => {
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(new ApiError(500, "Unable to save flag"));
    const user = userEvent.setup();
    await loadCard();
    await user.click(flagButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save flag");
    expect(navigator().getByRole("button", { name: "Question 1" })).toBeEnabled();
    expect(flagButton()).toBeEnabled();
    await user.click(flagButton());
    await expectFlagged(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks Finish Exam until a pending flag save completes", async () => {
    const data = makeAttempt();
    data.current_position = 2;
    for (const question of data.questions) {
      question.response = { question_version_id: question.id, selected_option_ids: null,
        text_response: "Submitted answer", is_submitted: true, answered_at: "2026-11-23T00:00:00Z" };
    }
    vi.mocked(getExam).mockResolvedValue(data);
    let resolveFlag!: (value: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementation(() => new Promise((resolve) => { resolveFlag = resolve; }));
    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await user.click(await screen.findByRole("button", { name: "Flag for Review" }));
    expect(navigator().getByRole("button", { name: "Finish Exam" })).toBeDisabled();
    await act(async () => resolveFlag(savedFlag("question-2", true)));
    await waitFor(() => expect(navigator().getByRole("button", { name: "Finish Exam" })).toBeEnabled());
    expect(submitExam).not.toHaveBeenCalled();
  });
});

describe("JHEP-104 mobile navigator", () => {
  afterEach(cleanup);
  it("shows flags across paginated sets without obscuring the current question", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn(() => true);
    const props = { currentQuestion: makeAttempt().questions[0], totalQuestions: 40, currentQuestionIndex: 0,
      flaggedQuestionIndices: [0, 39], isSubmitted: false, isSubmitting: false, isFinishing: false,
      allQuestionsSubmitted: false, finishError: "", variant: "mobile" as const, onNavigate, onFinish: vi.fn() };
    const { rerender } = render(<ExamSidebar {...props} />);
    const trigger = screen.getByRole("button", { name: /^Question navigation/i });
    await user.click(trigger);
    const panel = within(screen.getByRole("region", { name: "Mobile question navigation" }));
    const current = panel.getByRole("button", { name: "Question 1, flagged for review" });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(current.querySelector("svg.lucide-flag")).toBeInTheDocument();
    rerender(<ExamSidebar {...props} flaggedQuestionIndices={[39]} />);
    expect(panel.getByRole("button", { name: "Question 1" })).toHaveAttribute("aria-current", "step");
    await user.click(panel.getByRole("button", { name: "Next question set" }));
    await user.click(panel.getByRole("button", { name: "Next question set" }));
    const last = panel.getByRole("button", { name: "Question 40, flagged for review" });
    expect(last).toBeEnabled();
    await user.click(last);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(39);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Mobile question navigation" })).not.toBeInTheDocument();
  });
});
