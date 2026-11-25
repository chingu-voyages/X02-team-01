import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionState } from "@/lib/question-states";
import QuestionNavigator from "./QuestionNavigator";

afterEach(cleanup);

const states: QuestionState[] = [
  { questionId: "q1", responseState: "unanswered", isFlagged: true, isCurrent: false },
  { questionId: "q2", responseState: "unsubmitted", isFlagged: true, isCurrent: true },
  { questionId: "q3", responseState: "submitted", isFlagged: true, isCurrent: false },
  { questionId: "q4", responseState: "unanswered", isFlagged: false, isCurrent: false },
];

function navigator() {
  return within(screen.getByRole("navigation", { name: "Question navigation" }));
}

function renderNavigator(questionStates: QuestionState[] = states) {
  const onNavigate = vi.fn();
  const view = render(
    <QuestionNavigator
      totalQuestions={questionStates.length}
      currentQuestionIndex={questionStates.findIndex((question) => question.isCurrent)}
      questionStates={questionStates}
      onNavigate={onNavigate}
    />,
  );
  return { ...view, onNavigate };
}

function expectCounts(submitted: number, total: number, draft: number, flagged: number) {
  expect(navigator().getByText(`Submitted answers: ${submitted} / ${total}`)).toBeVisible();
  expect(navigator().getByText(`Remaining: ${total - submitted}`)).toBeVisible();
  expect(navigator().getByText(`Draft: ${draft} · Unanswered: ${total - submitted - draft} · Flagged: ${flagged}`)).toBeVisible();
}

describe("JHEP-106 QuestionNavigator states", () => {
  it("distinguishes all three response states", () => {
    renderNavigator();

    const unanswered = navigator().getByRole("button", { name: "Question 1, flagged for review" });
    const draft = navigator().getByRole("button", { name: "Question 2, flagged for review" });
    const submitted = navigator().getByRole("button", { name: "Question 3, flagged for review" });
    expect(unanswered).toHaveAccessibleDescription("Unanswered");
    expect(draft).toHaveAccessibleDescription("Selected but unsubmitted");
    expect(submitted).toHaveAccessibleDescription("Submitted");
    expect(navigator().getByRole("button", { name: "Question 4" })).toHaveAccessibleDescription("Unanswered");
    expect(unanswered.querySelector("svg.lucide-pencil")).toBeNull();
    expect(draft.querySelector("svg.lucide-pencil")).toBeInTheDocument();
    expect(submitted.querySelector("svg.lucide-send")).toBeInTheDocument();
  });

  it("distinguishes submission visually from grading feedback", () => {
    renderNavigator(states.map((question) => question.questionId === "q4" ? { ...question, responseState: "submitted" } : question));

    const flagged = navigator().getByRole("button", { name: "Question 3, flagged for review" });
    const unflagged = navigator().getByRole("button", { name: "Question 4" });
    for (const button of [flagged, unflagged]) {
      expect(button).toHaveAccessibleDescription("Submitted");
      expect(button).toHaveClass("bg-brand-secondary/75");
      expect(button).not.toHaveClass("bg-green-50");
      expect(button).not.toHaveClass("bg-red-50");
      expect(button.querySelector("svg.lucide-send")).toBeInTheDocument();
      expect(button.querySelector("svg.lucide-check")).toBeNull();
    }
    expect(flagged.querySelector("svg.lucide-flag")).toBeInTheDocument();
    expect(unflagged.querySelector("svg.lucide-flag")).toBeNull();

    const legend = within(navigator().getByRole("region", { name: "Question state legend" }));
    expect(legend.getByText("Submitted", { exact: true })).toBeVisible();
    expect(legend.getByText("Submitted means your answer was saved, not that it was correct.")).toBeVisible();
    expectCounts(2, 4, 1, 3);
  });

  it("preserves current, flagged and response states together", () => {
    renderNavigator();
    const current = navigator().getByRole("button", { name: "Question 2, flagged for review", current: "step" });
    expect(current).toHaveAccessibleDescription("Selected but unsubmitted");
    expect(current.querySelector("svg.lucide-flag")).toBeInTheDocument();
    expect(current.querySelector("svg.lucide-pencil")).toBeInTheDocument();
    expect(navigator().getAllByRole("button", { current: "step" })).toHaveLength(1);
  });

  it("counts only submitted questions as completed", () => {
    renderNavigator();
    expectCounts(1, 4, 1, 3);
  });

  it("updates counts and indicators after submission", () => {
    const { rerender, onNavigate } = renderNavigator();
    const updatedStates: QuestionState[] = states.map((question) => question.questionId === "q2" ? { ...question, responseState: "submitted" } : question);
    rerender(<QuestionNavigator totalQuestions={4} currentQuestionIndex={1} questionStates={updatedStates} onNavigate={onNavigate} />);

    const current = navigator().getByRole("button", { name: "Question 2, flagged for review", current: "step" });
    expect(current).toHaveAccessibleDescription("Submitted");
    expect(current.querySelector("svg.lucide-send")).toBeInTheDocument();
    expect(current.querySelector("svg.lucide-flag")).toBeInTheDocument();
    expect(current.querySelector("svg.lucide-pencil")).toBeNull();
    expectCounts(2, 4, 0, 3);
  });

  it("updates flags without changing the response state", () => {
    const { rerender, onNavigate } = renderNavigator();
    const updatedStates = states.map((question) => question.questionId === "q2" ? { ...question, isFlagged: false } : question);
    rerender(<QuestionNavigator totalQuestions={4} currentQuestionIndex={1} questionStates={updatedStates} onNavigate={onNavigate} />);

    const current = navigator().getByRole("button", { name: "Question 2", current: "step" });
    expect(current).toHaveAccessibleDescription("Selected but unsubmitted");
    expect(current.querySelector("svg.lucide-flag")).toBeNull();
    expect(current.querySelector("svg.lucide-pencil")).toBeInTheDocument();
    expect(navigator().queryByRole("button", { name: "Question 2, flagged for review" })).not.toBeInTheDocument();
    expectCounts(1, 4, 1, 2);
  });

  it("provides a visible non-colour-only legend", () => {
    renderNavigator();
    const legend = within(screen.getByRole("region", { name: "Question state legend" }));
    for (const label of ["Unanswered", "Selected but unsubmitted", "Submitted", "Flagged for review", "Current question", "Submitted + flagged"]) {
      expect(legend.getByText(label, { exact: true })).toBeVisible();
    }
  });

  it("preserves keyboard and direct navigation", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderNavigator();
    await user.tab();
    expect(navigator().getByRole("button", { name: "Question 1, flagged for review" })).toHaveFocus();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("supports long exams with global counts and state indicators on later pages", async () => {
    const user = userEvent.setup();
    const longExam: QuestionState[] = Array.from({ length: 100 }, (_, index) => ({
      questionId: `q${index + 1}`,
      responseState: index < 20 ? "submitted" : "unanswered",
      isFlagged: index === 99,
      isCurrent: index === 0,
    }));
    const { onNavigate } = renderNavigator(longExam);
    expectCounts(20, 100, 0, 1);
    expect(within(navigator().getByRole("list", { name: "Question numbers" })).getAllByRole("button")).toHaveLength(15);
    for (let page = 0; page < 6; page++) {
      await user.click(navigator().getByRole("button", { name: "Next question set" }));
      expectCounts(20, 100, 0, 1);
    }
    const finalQuestion = navigator().getByRole("button", { name: "Question 100, flagged for review" });
    expect(finalQuestion).toHaveAccessibleDescription("Unanswered");
    expect(finalQuestion.querySelector("svg.lucide-flag")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(finalQuestion);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(99);
  });

  it("handles empty attempts without invalid counts or paging", () => {
    renderNavigator([]);
    expect(navigator().queryAllByRole("button")).toHaveLength(0);
    expectCounts(0, 0, 0, 0);
  });

  it("remains compatible with the existing navigator props", () => {
    render(<QuestionNavigator totalQuestions={3} currentQuestionIndex={0} flaggedQuestionIndices={[1]} onNavigate={vi.fn()} />);
    expect(navigator().getAllByRole("button")).toHaveLength(3);
    expect(navigator().getByRole("button", { name: "Question 2, flagged for review" })).toHaveAccessibleDescription("Unanswered");
    expect(navigator().getByRole("button", { name: "Question 1", current: "step" })).toBeInTheDocument();
    expectCounts(0, 3, 0, 1);
  });
});
