import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuestionRenderer from "./QuestionRenderer";
import type { ExamQuestionWithResponse } from "@/types/exam-api.types";

vi.mock("@/features/questions/OptionItem", () => ({
  default: ({
    id,
    option,
    isSelected,
    onSelect,
    disabled,
  }: {
    id: string;
    option: string;
    isSelected: boolean;
    onSelect: () => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      data-testid={`option-${id}`}
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={onSelect}
    >
      {option}
    </button>
  ),
}));

vi.mock("./QuestionMedia", () => ({
  default: () => null,
}));

vi.mock("./FeedbackCard", () => ({
  default: () => <div data-testid="feedback-card">Feedback</div>,
}));

const singleChoiceQuestion: ExamQuestionWithResponse = {
  id: "q-1",
  question_type: "multiple_choice",
  allows_multiple_answers: false,
  question_text: "Which artifact represents work for the Sprint?",
  images: [],
  options: [
    { id: "opt-1", position: 1, option_text: "Product Backlog" },
    { id: "opt-2", position: 2, option_text: "Sprint Backlog" },
  ],
} as unknown as ExamQuestionWithResponse;

const shortAnswerQuestion: ExamQuestionWithResponse = {
  id: "q-2",
  question_type: "short_answer",
  allows_multiple_answers: false,
  question_text: "Define empiricism in one sentence.",
  images: [],
  options: [],
} as unknown as ExamQuestionWithResponse;

function renderQuestionRenderer(
  overrides: Partial<React.ComponentProps<typeof QuestionRenderer>> = {},
) {
  const defaultProps: React.ComponentProps<typeof QuestionRenderer> = {
    question: singleChoiceQuestion,
    questionIndex: 0,
    totalQuestions: 5,
    selectedOptionIds: [],
    textValue: "",
    isSubmitted: false,
    isSubmitting: false,
    isFinishing: false,
    submitError: "",
    allQuestionsSubmitted: false,
    firstUnsubmittedIndex: 1,
    onSelectOption: vi.fn(),
    onTextChange: vi.fn(),
    onSubmit: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReviewUnsubmitted: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<QuestionRenderer {...defaultProps} />),
    props: defaultProps,
  };
}

describe("QuestionRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders question stem, options, and keeps Submit disabled until an option is selected", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Which artifact represents work for the Sprint?",
      }),
    ).toBeTruthy();

    const submitButton = screen.getByRole("button", {
      name: "Submit answer",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    await user.click(screen.getByTestId("option-opt-2"));
    expect(props.onSelectOption).toHaveBeenCalledWith("opt-2");
  });

  it("enables Submit when an option is selected and calls onSubmit", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer({
      selectedOptionIds: ["opt-2"],
    });

    const submitButton = screen.getByRole("button", {
      name: "Submit answer",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    await user.click(submitButton);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders short answer textarea and forwards input changes", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer({
      question: shortAnswerQuestion,
      textValue: "",
    });

    const textarea = screen.getByLabelText("Your answer");
    await user.type(textarea, "Transparency");
    expect(props.onTextChange).toHaveBeenCalled();
  });

  it("renders feedback and Next question button after submission", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer({
      isSubmitted: true,
      questionIndex: 1,
      totalQuestions: 5,
    });

    expect(screen.getByTestId("feedback-card")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(props.onNext).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("shows Review unanswered questions or completion message on the last question", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderQuestionRenderer({
      isSubmitted: true,
      questionIndex: 4,
      totalQuestions: 5,
      allQuestionsSubmitted: false,
      firstUnsubmittedIndex: 2,
    });

    await user.click(
      screen.getByRole("button", { name: "Review unanswered questions" }),
    );
    expect(props.onReviewUnsubmitted).toHaveBeenCalledTimes(1);

    rerender(
      <QuestionRenderer
        {...props}
        isSubmitted
        questionIndex={4}
        totalQuestions={5}
        allQuestionsSubmitted
      />,
    );

    expect(
      screen.getByText(
        "All answers submitted. Finish the exam in the progress panel.",
      ),
    ).toBeTruthy();
  });

  it("displays submitError alert when submission fails", () => {
    renderQuestionRenderer({
      submitError: "Failed to save answer.",
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Failed to save answer.",
    );
  });
});