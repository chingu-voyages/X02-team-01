import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";

import QuestionRenderer from "./QuestionRenderer";
import type { ExamQuestionWithResponse } from "@/types/exam-api.types";

// Isolate the renderer's prop wiring from the underlying option controls.
vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, "aria-labelledby": labelledBy }: {
    children: ReactNode;
    "aria-labelledby"?: string;
  }) => <div role="radiogroup" aria-labelledby={labelledBy}>{children}</div>,
}));

vi.mock("@/features/questions/OptionItem", () => ({
  default: ({
    id,
    option,
    isSelected,
    onSelect,
    disabled,
    isSubmitted,
  }: {
    id: string;
    option: string;
    isSelected: boolean;
    onSelect: () => void;
    disabled: boolean;
    isSubmitted: boolean;
  }) => (
    <button
      type="button"
      data-testid={`option-${id}`}
      aria-pressed={isSelected}
      disabled={disabled || isSubmitted}
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
  position: 1,
  difficulty: "medium",
  question_type: "multiple_choice",
  allows_multiple_answers: false,
  question_text: "Which artifact represents work for the Sprint?",
  images: [],
  options: [
    { id: "opt-1", position: 1, option_text: "Product Backlog" },
    { id: "opt-2", position: 2, option_text: "Sprint Backlog" },
  ],
};

const shortAnswerQuestion: ExamQuestionWithResponse = {
  id: "q-2",
  position: 2,
  difficulty: "medium",
  question_type: "short_answer",
  allows_multiple_answers: false,
  question_text: "Define empiricism in one sentence.",
  images: [],
  options: [],
};

function renderQuestionRenderer(
  overrides: Partial<ComponentProps<typeof QuestionRenderer>> = {},
) {
  const defaultProps: ComponentProps<typeof QuestionRenderer> = {
    question: singleChoiceQuestion,
    selectedOptionIds: [],
    textValue: "",
    isSubmitted: false,
    isSubmitting: false,
    isFinishing: false,
    submitError: "",
    onSelectOption: vi.fn(),
    onTextChange: vi.fn(),
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

  it("renders the question stem and options and forwards option selection", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Which artifact represents work for the Sprint?",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getByText("Product Backlog")).toBeTruthy();
    expect(screen.getByText("Sprint Backlog")).toBeTruthy();
    expect(screen.queryByTestId("feedback-card")).toBeNull();

    await user.click(screen.getByTestId("option-opt-2"));
    expect(props.onSelectOption).toHaveBeenCalledWith("opt-2");
  });

  it("reflects a selected option from the current response", () => {
    renderQuestionRenderer({ selectedOptionIds: ["opt-2"] });

    expect(screen.getByTestId("option-opt-1").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("option-opt-2").getAttribute("aria-pressed")).toBe("true");
  });

  it("renders multiple-choice options as a group and forwards selection", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer({
      question: { ...singleChoiceQuestion, allows_multiple_answers: true },
      selectedOptionIds: ["opt-1"],
    });

    expect(screen.getByRole("group", { name: singleChoiceQuestion.question_text })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    await user.click(screen.getByTestId("option-opt-2"));
    expect(props.onSelectOption).toHaveBeenCalledWith("opt-2");
  });

  it("renders the short-answer textarea and forwards input changes", () => {
    const { props } = renderQuestionRenderer({ question: shortAnswerQuestion });

    const textarea = screen.getByRole("textbox", { name: "Your answer" });
    fireEvent.change(textarea, { target: { value: "Transparency" } });
    expect(props.onTextChange).toHaveBeenCalledWith("Transparency");
  });

  it("renders feedback and locks the selected answer after submission", async () => {
    const user = userEvent.setup();
    const { props } = renderQuestionRenderer({
      isSubmitted: true,
      selectedOptionIds: ["opt-2"],
    });

    expect(screen.getByTestId("feedback-card")).toBeTruthy();
    const option = screen.getByTestId("option-opt-2") as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    expect(option.getAttribute("aria-pressed")).toBe("true");
    await user.click(option);
    expect(props.onSelectOption).not.toHaveBeenCalled();
  });

  it.each(["isSubmitted", "isSubmitting", "isFinishing"] as const)(
    "locks short-answer input when %s is true",
    (state) => {
      renderQuestionRenderer({
        question: shortAnswerQuestion,
        textValue: "Existing answer",
        [state]: true,
      });
      const textarea = screen.getByRole("textbox", { name: "Your answer" }) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
      expect(textarea.value).toBe("Existing answer");
    },
  );

  it("displays submitError alert when submission fails", () => {
    renderQuestionRenderer({ submitError: "Failed to save answer." });

    expect(screen.getByRole("alert").textContent).toBe("Failed to save answer.");
  });
});
