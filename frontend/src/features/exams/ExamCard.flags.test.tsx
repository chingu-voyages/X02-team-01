import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { ApiError } from "@/lib/api-client";
import type { ExamAttempt, QuestionFlagSaved } from "@/types/exam-api.types";
import ExamCard from "./ExamCard";
import MobileQuestionNavigation from "./MobileQuestionNavigation";

const { handleError, replace } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ ready: true, token: "test-token", handleError }),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  setQuestionFlag: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("@/lib/exam-submission", () => ({
  submitExam: vi.fn(),
}));

const attemptId = "attempt-1";

function makeAttempt(): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "cert-1",
    status: "in_progress",
    question_count: 2,
    current_position: 1,
    questions: [1, 2].map((position) => ({
      id: `question-${position}`,
      position,
      question_text: `Explain concept ${position}`,
      question_type: "short_answer",
      allows_multiple_answers: false,
      difficulty: "easy",
      options: [],
      images: [],
      flagged_for_review: false,
    })),
  };
}

function savedFlag(questionId: string, flagged: boolean): QuestionFlagSaved {
  return {
    attempt_id: attemptId,
    question_version_id: questionId,
    flagged_for_review: flagged,
  };
}

function navigator() {
  return within(screen.getByRole("navigation", { name: "Question navigation" }));
}

async function loadCard() {
  render(<ExamCard attemptId={attemptId} />);
  await screen.findByRole("heading", { name: "Explain concept 1" });
}

describe("JHEP-104 exam flag interface", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getExam).mockResolvedValue(makeAttempt());
    vi.mocked(setQuestionFlag).mockImplementation(async (_attempt, question, flag) =>
      savedFlag(question, flag),
    );
  });

  afterEach(cleanup);

  it("flags, navigates and unflags without losing a draft or submitting an answer", async () => {
    const user = userEvent.setup();
    await loadCard();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "My draft");

    const flag = screen.getByRole("button", { name: "Flag for Review" });
    flag.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Remove Flag" });
    expect(setQuestionFlag).toHaveBeenCalledExactlyOnceWith(attemptId, "question-1", true, "test-token");
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" }))
      .toHaveAttribute("aria-current", "step");

    await user.click(navigator().getByRole("button", { name: "Question 2" }));
    expect(screen.getByRole("button", { name: "Flag for Review" })).toBeEnabled();
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" }))
      .not.toHaveAttribute("aria-current");
    await user.click(navigator().getByRole("button", { name: "Question 1, flagged for review" }));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("My draft");

    await user.click(screen.getByRole("button", { name: "Remove Flag" }));
    await screen.findByRole("button", { name: "Flag for Review" });
    expect(navigator().getByRole("button", { name: /^Question 1$/ }))
      .toHaveAttribute("aria-current", "step");
    expect(setQuestionFlag).toHaveBeenLastCalledWith(attemptId, "question-1", false, "test-token");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(screen.getByText("Submitted answers: 0 / 2")).toBeInTheDocument();
  });

  it("shows saved flags on load and allows flagging a locked submitted answer", async () => {
    const data = makeAttempt();
    data.questions[0].flagged_for_review = true;
    data.questions[0].response = {
      question_version_id: "question-1",
      selected_option_ids: null,
      text_response: "Locked answer",
      is_submitted: true,
      answered_at: "2026-11-23T00:00:00Z",
    };
    vi.mocked(getExam).mockResolvedValue(data);
    const user = userEvent.setup();
    await loadCard();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("Locked answer");
    await user.click(screen.getByRole("button", { name: "Remove Flag" }));
    await user.click(await screen.findByRole("button", { name: "Flag for Review" }));
    await screen.findByRole("button", { name: "Remove Flag" });
    expect(screen.getByRole("textbox", { name: "Your answer" })).toBeDisabled();
    expect(screen.getByText("Submitted answers: 1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Correct answer.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer.", { exact: true })).not.toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("disables duplicate flag and answer submission actions while saving, but allows navigation", async () => {
    let resolveFlag!: (value: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementation(() => new Promise((resolve) => {
      resolveFlag = resolve;
    }));
    const user = userEvent.setup();
    await loadCard();
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "Draft");
    await user.click(screen.getByRole("button", { name: "Flag for Review" }));
    expect(screen.getByRole("button", { name: "Flag for Review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    expect(screen.getByText("Saving review flag...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Flag for Review" }));
    expect(setQuestionFlag).toHaveBeenCalledTimes(1);
    await user.click(navigator().getByRole("button", { name: "Question 2" }));
    await act(async () => resolveFlag(savedFlag("question-1", true)));
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Flag for Review" })).toBeEnabled();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("shows an accessible save error, keeps the old flag and allows retry", async () => {
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(new ApiError(500, "Unable to save flag"));
    const user = userEvent.setup();
    await loadCard();
    await user.click(screen.getByRole("button", { name: "Flag for Review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save flag");
    expect(navigator().getByRole("button", { name: /^Question 1$/ })).toBeEnabled();
    const retry = screen.getByRole("button", { name: "Flag for Review" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    await screen.findByRole("button", { name: "Remove Flag" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks Finish Exam until a pending flag save completes", async () => {
    const data = makeAttempt();
    data.current_position = 2;
    for (const question of data.questions) {
      question.response = {
        question_version_id: question.id,
        selected_option_ids: null,
        text_response: "Submitted answer",
        is_submitted: true,
        answered_at: "2026-11-23T00:00:00Z",
      };
    }
    vi.mocked(getExam).mockResolvedValue(data);
    let resolveFlag!: (value: QuestionFlagSaved) => void;
    vi.mocked(setQuestionFlag).mockImplementation(() => new Promise((resolve) => {
      resolveFlag = resolve;
    }));
    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await user.click(await screen.findByRole("button", { name: "Flag for Review" }));
    expect(screen.getByRole("button", { name: "Finish Exam" })).toBeDisabled();
    await act(async () => resolveFlag(savedFlag("question-2", true)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish Exam" })).toBeEnabled());
    expect(submitExam).not.toHaveBeenCalled();
  });
});

describe("JHEP-104 mobile navigator", () => {
  afterEach(cleanup);

  it("shows flags in the modal without obscuring the current question", async () => {
    // jsdom versions differ in native dialog support. Emulate only the
    // open/close API when necessary; browser focus and modality are covered by E2E.
    const prototype = HTMLDialogElement.prototype;
    const originalShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(prototype, "close");
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
    });
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
    });
    try {
      const user = userEvent.setup();
      const onNavigate = vi.fn(() => true);
      const { rerender } = render(
        <MobileQuestionNavigation totalQuestions={40} currentQuestionIndex={0} flaggedQuestionIndices={[0, 39]} onNavigate={onNavigate} />,
      );
      await user.click(screen.getByRole("button", { name: /^Question Navigation/ }));
      const dialog = within(screen.getByRole("dialog", { name: "Question Navigation" }));
      expect(dialog.getByRole("button", { name: "Question 1, flagged for review" })).toHaveAttribute("aria-current", "step");
      expect(dialog.getByRole("button", { name: "Question 40, flagged for review" })).toBeEnabled();
      rerender(<MobileQuestionNavigation totalQuestions={40} currentQuestionIndex={0} flaggedQuestionIndices={[39]} onNavigate={onNavigate} />);
      expect(dialog.getByRole("button", { name: /^Question 1$/ })).toHaveAttribute("aria-current", "step");
      await user.click(dialog.getByRole("button", { name: "Question 40, flagged for review" }));
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith(39);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      cleanup();
      if (originalShow) Object.defineProperty(prototype, "showModal", originalShow);
      else Reflect.deleteProperty(prototype, "showModal");
      if (originalClose) Object.defineProperty(prototype, "close", originalClose);
      else Reflect.deleteProperty(prototype, "close");
    }
  });
});
