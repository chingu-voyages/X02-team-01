import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionState } from "@/lib/question-states";
import QuestionNavigator from "./QuestionNavigator";

afterEach(cleanup);

const states: QuestionState[] = [
  {
    questionId: "q1",
    responseState: "unanswered",
    isFlagged: true,
    isCurrent: false,
  },
  {
    questionId: "q2",
    responseState: "unsubmitted",
    isFlagged: true,
    isCurrent: true,
  },
  {
    questionId: "q3",
    responseState: "submitted",
    isFlagged: true,
    isCurrent: false,
  },
  {
    questionId: "q4",
    responseState: "unanswered",
    isFlagged: false,
    isCurrent: false,
  },
];

function navigator() {
  return within(
    screen.getByRole("navigation", {
      name: "Question navigation",
    }),
  );
}

function renderNavigator(
  questionStates: QuestionState[] = states,
) {
  const onNavigate = vi.fn();

  const view = render(
    <QuestionNavigator
      totalQuestions={questionStates.length}
      currentQuestionIndex={questionStates.findIndex(
        (question) => question.isCurrent,
      )}
      questionStates={questionStates}
      onNavigate={onNavigate}
    />,
  );

  return { ...view, onNavigate };
}

describe("JHEP-106 QuestionNavigator states", () => {
  it("distinguishes all three response states", () => {
    renderNavigator();

    expect(
      navigator().getByRole("button", {
        name: "Question 1, flagged for review",
      }),
    ).toHaveAccessibleDescription("Unanswered");

    expect(
      navigator().getByRole("button", {
        name: "Question 2, flagged for review",
      }),
    ).toHaveAccessibleDescription("Selected but unsubmitted");

    expect(
      navigator().getByRole("button", {
        name: "Question 3, flagged for review",
      }),
    ).toHaveAccessibleDescription("Submitted");

    expect(
      navigator().getByRole("button", {
        name: "Question 4",
      }),
    ).toHaveAccessibleDescription("Unanswered");
  });

  it("distinguishes submission visually from grading feedback", () => {
    renderNavigator(
      states.map((question) =>
        question.questionId === "q4"
          ? { ...question, responseState: "submitted" }
          : question,
      ),
    );

    const flagged = navigator().getByRole("button", {
      name: "Question 3, flagged for review",
    });
    const unflagged = navigator().getByRole("button", {
      name: "Question 4",
    });

    for (const button of [flagged, unflagged]) {
      expect(button).toHaveAccessibleDescription("Submitted");
      expect(button).toHaveClass("border-indigo-300", "bg-indigo-50");
      expect(button).not.toHaveClass("bg-green-50");
      expect(button).not.toHaveClass("bg-red-50");
      expect(button.querySelector("svg.lucide-send")).toBeInTheDocument();
      expect(button.querySelector("svg.lucide-check")).toBeNull();
    }

    expect(flagged.querySelector("svg.lucide-flag")).toBeInTheDocument();
    expect(unflagged.querySelector("svg.lucide-flag")).toBeNull();

    const legend = within(
      navigator().getByRole("region", { name: "Question state legend" }),
    );
    expect(legend.getByText("Submitted", { exact: true })).toBeVisible();
    expect(
      legend.getByText(
        "Submitted means your answer was saved, not that it was correct.",
        { exact: true },
      ),
    ).toBeVisible();

    expect(navigator().getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "2 of 4 questions submitted",
    );
  });

  it("preserves current, flagged and response states together", () => {
    renderNavigator();

    const current = navigator().getByRole("button", {
      name: "Question 2, flagged for review",
      current: "step",
    });

    expect(current).toBeInTheDocument();

    expect(current).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    expect(
      navigator().getAllByRole("button", {
        current: "step",
      }),
    ).toHaveLength(1);
  });

  it("counts only submitted questions toward progress", () => {
    renderNavigator();

    const progress = navigator().getByRole("progressbar", {
      name: "Exam submission progress",
    });

    expect(progress).toHaveAttribute(
      "aria-valuenow",
      "25",
    );

    expect(progress).toHaveAttribute(
      "aria-valuetext",
      "1 of 4 questions submitted",
    );

    expect(
      navigator().getByText("Remaining").parentElement,
    ).toHaveTextContent("3");
  });

  it("updates progress and indicators after submission", () => {
    const { rerender, onNavigate } = renderNavigator();

    const updatedStates: QuestionState[] = states.map(
      (question) =>
        question.questionId === "q2"
          ? {
              ...question,
              responseState: "submitted",
            }
          : question,
    );

    rerender(
      <QuestionNavigator
        totalQuestions={4}
        currentQuestionIndex={1}
        questionStates={updatedStates}
        onNavigate={onNavigate}
      />,
    );

    expect(
      navigator().getByRole("button", {
        name: "Question 2, flagged for review",
        current: "step",
      }),
    ).toHaveAccessibleDescription("Submitted");

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "50");

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute(
      "aria-valuetext",
      "2 of 4 questions submitted",
    );
  });

  it("updates flags without changing the response state", () => {
    const { rerender, onNavigate } = renderNavigator();

    const updatedStates = states.map((question) =>
      question.questionId === "q2"
        ? { ...question, isFlagged: false }
        : question,
    );

    rerender(
      <QuestionNavigator
        totalQuestions={4}
        currentQuestionIndex={1}
        questionStates={updatedStates}
        onNavigate={onNavigate}
      />,
    );

    expect(
      navigator().getByRole("button", {
        name: "Question 2",
        current: "step",
      }),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    expect(
      navigator().queryByRole("button", {
        name: "Question 2, flagged for review",
      }),
    ).not.toBeInTheDocument();

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "25");
  });

  it("provides a visible non-colour-only legend", () => {
    renderNavigator();

    const legend = within(
      screen.getByRole("region", {
        name: "Question state legend",
      }),
    );

    for (const label of [
      "Unanswered",
      "Selected but unsubmitted",
      "Submitted",
      "Flagged for review",
      "Current question",
    ]) {
      expect(legend.getByText(label)).toBeVisible();
    }
  });

  it("preserves keyboard and direct navigation", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderNavigator();

    await user.tab();

    expect(
      navigator().getByRole("button", {
        name: "Question 1, flagged for review",
      }),
    ).toHaveFocus();

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("supports long exams with state indicators", () => {
    const longExam: QuestionState[] = Array.from(
      { length: 100 },
      (_, index) => ({
        questionId: `q${index + 1}`,
        responseState:
          index < 20 ? "submitted" : "unanswered",
        isFlagged: index === 99,
        isCurrent: index === 0,
      }),
    );

    renderNavigator(longExam);

    expect(
      navigator().getAllByRole("button"),
    ).toHaveLength(100);

    expect(
      navigator().getByRole("button", {
        name: "Question 100, flagged for review",
      }),
    ).toHaveAccessibleDescription("Unanswered");

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "20");
  });

  it("handles empty attempts without invalid progress", () => {
    renderNavigator([]);

    expect(
      navigator().queryAllByRole("button"),
    ).toHaveLength(0);

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "0");

    expect(
      navigator().getByRole("progressbar"),
    ).toHaveAttribute(
      "aria-valuetext",
      "0 of 0 questions submitted",
    );
  });

  it("remains compatible with the existing navigator props", () => {
    render(
      <QuestionNavigator
        totalQuestions={3}
        currentQuestionIndex={0}
        flaggedQuestionIndices={[1]}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      navigator().getAllByRole("button"),
    ).toHaveLength(3);

    expect(
      navigator().getByRole("button", {
        name: "Question 2, flagged for review",
      }),
    ).toBeInTheDocument();

    expect(
      navigator().getByRole("button", {
        name: "Question 1",
        current: "step",
      }),
    ).toBeInTheDocument();
  });
});