import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuestionControls from "./QuestionControls";

function renderQuestionControls(
  overrides: Partial<React.ComponentProps<typeof QuestionControls>> = {},
) {
  const defaultProps: React.ComponentProps<typeof QuestionControls> = {
    questionIndex: 1,
    totalQuestions: 5,
    selectedCount: 0,
    isSubmitted: false,
    isSubmitting: false,
    isFinishing: false,
    isSavingFlag: false,
    allQuestionsSubmitted: false,
    firstUnsubmittedIndex: 2,
    onSubmit: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReviewUnsubmitted: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<QuestionControls {...defaultProps} />),
    props: defaultProps,
  };
}

describe("QuestionControls", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables Previous on the first question and triggers onPrevious on later questions", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderQuestionControls({ questionIndex: 0 });

    const previousButton = screen.getByRole("button", {
      name: "Previous",
    }) as HTMLButtonElement;
    expect(previousButton.disabled).toBe(true);

    rerender(<QuestionControls {...props} questionIndex={1} />);

    const enabledPrevious = screen.getByRole("button", {
      name: "Previous",
    }) as HTMLButtonElement;
    expect(enabledPrevious.disabled).toBe(false);

    await user.click(enabledPrevious);
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("keeps Submit answer disabled when nothing is selected or a flag is saving", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderQuestionControls({ selectedCount: 0 });

    const submitButton = screen.getByRole("button", {
      name: "Submit answer",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    rerender(
      <QuestionControls {...props} selectedCount={1} isSavingFlag />,
    );
    expect(submitButton.disabled).toBe(true);

    rerender(
      <QuestionControls {...props} selectedCount={1} isSavingFlag={false} />,
    );
    expect(submitButton.disabled).toBe(false);

    await user.click(submitButton);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows Submitting... while submission is in flight", () => {
    renderQuestionControls({
      selectedCount: 1,
      isSubmitting: true,
    });

    const submittingButton = screen.getByRole("button", {
      name: "Submitting...",
    }) as HTMLButtonElement;
    expect(submittingButton.disabled).toBe(true);
  });

  it("renders Next Question after submission when not on the last question", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionControls({
      questionIndex: 1,
      totalQuestions: 5,
      isSubmitted: true,
    });

    const nextButton = screen.getByRole("button", { name: "Next Question" });
    await user.click(nextButton);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("renders Review unanswered questions or completion message on the last question", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderQuestionControls({
      questionIndex: 4,
      totalQuestions: 5,
      isSubmitted: true,
      allQuestionsSubmitted: false,
      firstUnsubmittedIndex: 2,
    });

    await user.click(
      screen.getByRole("button", { name: "Review unanswered questions" }),
    );
    expect(props.onReviewUnsubmitted).toHaveBeenCalledTimes(1);

    rerender(
      <QuestionControls
        {...props}
        questionIndex={4}
        totalQuestions={5}
        isSubmitted
        allQuestionsSubmitted
      />,
    );

    expect(
      screen.getByText(
        "All answers submitted. Finish the exam in the progress panel.",
      ),
    ).toBeTruthy();
  });
});