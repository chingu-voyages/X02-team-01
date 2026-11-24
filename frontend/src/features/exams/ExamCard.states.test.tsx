import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import ExamCard from "./ExamCard";
import MobileQuestionNavigation from "./MobileQuestionNavigation";
import {
  getExam,
  setQuestionFlag,
  submitAnswer,
} from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { ApiError } from "@/lib/api-client";
import type {
  ExamAttempt,
  QuestionFlagSaved,
} from "@/types/exam-api.types";
import type { QuestionState } from "@/lib/question-states";

const { handleError, replace, logout } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    ready: true,
    token: "test-token",
    handleError,
  }),
  useAuth: () => ({ logout }),
}));

vi.mock("@/lib/exam-api", () => ({
  getExam: vi.fn(),
  setQuestionFlag: vi.fn(),
  submitAnswer: vi.fn(),
}));

vi.mock("@/lib/exam-submission", () => ({
  submitExam: vi.fn(),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/features/questions/OptionItem", () => ({
  default: ({
    option,
    isSelected,
    isSubmitted,
    disabled,
    onSelect,
  }: {
    option: string;
    isSelected: boolean;
    isSubmitted: boolean;
    disabled?: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={isSubmitted || disabled}
      onClick={onSelect}
    >
      {option}
    </button>
  ),
}));

const attemptId = "attempt-1";

function makeAttempt(): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "cert-1",
    status: "in_progress",
    question_count: 3,
    current_position: 1,
    questions: [
      {
        id: "q1",
        position: 1,
        question_text: "Single choice question",
        question_type: "multiple_choice",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        flagged_for_review: false,
        options: [
          {
            id: "q1-a",
            position: 1,
            option_text: "First choice",
          },
          {
            id: "q1-b",
            position: 2,
            option_text: "Second choice",
          },
        ],
      },
      {
        id: "q2",
        position: 2,
        question_text: "Multiple select question",
        question_type: "multiple_choice",
        allows_multiple_answers: true,
        difficulty: "easy",
        images: [],
        flagged_for_review: false,
        options: [
          {
            id: "q2-a",
            position: 1,
            option_text: "Multiple choice A",
          },
          {
            id: "q2-b",
            position: 2,
            option_text: "Multiple choice B",
          },
        ],
      },
      {
        id: "q3",
        position: 3,
        question_text: "Short answer question",
        question_type: "short_answer",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [],
        flagged_for_review: false,
      },
    ],
  };
}

function desktopNavigator() {
  const sidebar = within(
    screen.getByRole("complementary", {
      name: "Attempt progress",
    }),
  );

  return within(
    sidebar.getByRole("navigation", {
      name: "Question navigation",
    }),
  );
}

function questionButton(
  number: number,
  flagged = false,
) {
  return desktopNavigator().getByRole("button", {
    name: `Question ${number}${
      flagged ? ", flagged for review" : ""
    }`,
  });
}

function expectProgress(submitted: number, total = 3) {
  expect(
    desktopNavigator().getByRole("progressbar", {
      name: "Exam submission progress",
    }),
  ).toHaveAttribute(
    "aria-valuetext",
    `${submitted} of ${total} questions submitted`,
  );
}

function mobileTrigger() {
  return screen.getByRole("button", {
    name: /^Question Navigation/,
  });
}

function mobileDialog() {
  return within(
    screen.getByRole("dialog", {
      name: "Question Navigation",
    }),
  );
}

async function loadCard() {
  render(<ExamCard attemptId={attemptId} />);

  await screen.findByRole("heading", {
    name: "Single choice question",
  });
}

// Support jsdom versions without native dialog methods.
// Real browser modality and focus trapping are covered by E2E.

const dialogPrototype = HTMLDialogElement.prototype;

const originalShowModal =
  Object.getOwnPropertyDescriptor(
    dialogPrototype,
    "showModal",
  );

const originalClose =
  Object.getOwnPropertyDescriptor(
    dialogPrototype,
    "close",
  );

beforeAll(() => {
  if (typeof dialogPrototype.showModal !== "function") {
    Object.defineProperty(dialogPrototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
  }

  if (typeof dialogPrototype.close !== "function") {
    Object.defineProperty(dialogPrototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  }
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(
      dialogPrototype,
      "showModal",
      originalShowModal,
    );
  } else {
    Reflect.deleteProperty(dialogPrototype, "showModal");
  }

  if (originalClose) {
    Object.defineProperty(
      dialogPrototype,
      "close",
      originalClose,
    );
  } else {
    Reflect.deleteProperty(dialogPrototype, "close");
  }
});

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(getExam).mockResolvedValue(makeAttempt());

  vi.mocked(submitAnswer).mockImplementation(
    async (_attempt, questionId) => ({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: false,
    }),
  );

  vi.mocked(setQuestionFlag).mockImplementation(
    async (examId, questionId, flagged) => ({
      attempt_id: examId,
      question_version_id: questionId,
      flagged_for_review: flagged,
    }),
  );
});

afterEach(cleanup);

describe("JHEP-106 live question state indicators", () => {
  it("updates from unanswered to unsubmitted to submitted", async () => {
    const user = userEvent.setup();

    await loadCard();

    expect(questionButton(1))
      .toHaveAccessibleDescription("Unanswered");

    expectProgress(0);

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    expect(questionButton(1))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    expectProgress(0);
    expect(submitAnswer).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1))
        .toHaveAccessibleDescription("Submitted");
    });

    expectProgress(1);

    expect(
      screen.getByRole("button", {
        name: "First choice",
      }),
    ).toBeDisabled();

    expect(questionButton(2))
      .toHaveAccessibleDescription("Unanswered");

    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("returns to unanswered when all multiple selections are cleared", async () => {
    const user = userEvent.setup();

    await loadCard();

    await user.click(questionButton(2));

    const optionA = screen.getByRole("button", {
      name: "Multiple choice A",
    });

    const optionB = screen.getByRole("button", {
      name: "Multiple choice B",
    });

    await user.click(optionA);
    await user.click(optionB);

    expect(questionButton(2))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    await user.click(optionA);

    expect(questionButton(2))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    await user.click(optionB);

    expect(questionButton(2))
      .toHaveAccessibleDescription("Unanswered");

    expectProgress(0);
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("tracks short-answer drafts and ignores whitespace-only answers", async () => {
    const user = userEvent.setup();

    await loadCard();

    await user.click(questionButton(3));

    const answer = screen.getByRole("textbox", {
      name: "Your answer",
    });

    await user.type(answer, "   ");

    expect(questionButton(3))
      .toHaveAccessibleDescription("Unanswered");

    await user.type(answer, "My draft answer");

    expect(questionButton(3))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    await user.click(questionButton(1));

    expect(questionButton(3))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    await user.click(questionButton(3));

    expect(
      screen.getByRole("textbox", {
        name: "Your answer",
      }),
    ).toHaveValue("   My draft answer");

    await user.clear(
      screen.getByRole("textbox", {
        name: "Your answer",
      }),
    );

    expect(questionButton(3))
      .toHaveAccessibleDescription("Unanswered");

    expectProgress(0);
  });

  it("preserves flags across unanswered, unsubmitted and submitted states", async () => {
    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "Flag for Review",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1, true))
        .toHaveAccessibleDescription("Unanswered");
    });

    expectProgress(0);

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    expect(questionButton(1, true))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    expectProgress(0);

    await user.click(questionButton(2));

    expect(questionButton(1, true))
      .not.toHaveAttribute("aria-current");

    await user.click(questionButton(1, true));

    expect(questionButton(1, true))
      .toHaveAttribute("aria-current", "step");

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1, true))
        .toHaveAccessibleDescription("Submitted");
    });

    expectProgress(1);

    await user.click(
      screen.getByRole("button", {
        name: "Remove Flag",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1))
        .toHaveAccessibleDescription("Submitted");
    });

    expect(questionButton(1))
      .toHaveAttribute("aria-current", "step");

    expectProgress(1);

    expect(setQuestionFlag).toHaveBeenCalledTimes(2);
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("updates the original question after a pending flag save", async () => {
    let resolveFlag!: (saved: QuestionFlagSaved) => void;

    vi.mocked(setQuestionFlag).mockImplementationOnce(
      () =>
        new Promise<QuestionFlagSaved>((resolve) => {
          resolveFlag = resolve;
        }),
    );

    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "Flag for Review",
      }),
    );

    expect(questionButton(1))
      .toHaveAccessibleDescription("Unanswered");

    await user.click(questionButton(2));

    await act(async () => {
      resolveFlag({
        attempt_id: attemptId,
        question_version_id: "q1",
        flagged_for_review: true,
      });
    });

    expect(questionButton(1, true))
      .toHaveAccessibleDescription("Unanswered");

    expect(questionButton(1, true))
      .not.toHaveAttribute("aria-current");

    expect(questionButton(2))
      .toHaveAttribute("aria-current", "step");

    expectProgress(0);
  });

  it("does not count failed submissions as completed", async () => {
    vi.mocked(submitAnswer).mockRejectedValueOnce(
      new ApiError(500, "Unable to submit answer"),
    );

    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    expect(
      await screen.findByText("Unable to submit answer"),
    ).toHaveAttribute("role", "alert");

    expect(questionButton(1))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    expectProgress(0);

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1))
        .toHaveAccessibleDescription("Submitted");
    });

    expectProgress(1);
    expect(submitAnswer).toHaveBeenCalledTimes(2);
  });

  it("preserves the previous question state when flagging fails", async () => {
    vi.mocked(setQuestionFlag).mockRejectedValueOnce(
      new ApiError(500, "Unable to save flag"),
    );

    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Flag for Review",
      }),
    );

    expect(
      await screen.findByText("Unable to save flag"),
    ).toHaveAttribute("role", "alert");

    expect(questionButton(1))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    expect(
      desktopNavigator().queryByRole("button", {
        name: "Question 1, flagged for review",
      }),
    ).not.toBeInTheDocument();

    expectProgress(0);

    await user.click(
      screen.getByRole("button", {
        name: "Flag for Review",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1, true))
        .toHaveAccessibleDescription(
          "Selected but unsubmitted",
        );
    });

    expectProgress(0);
  });

  it("derives initial indicators from the loaded attempt", async () => {
    const data = makeAttempt();

    data.questions[0].flagged_for_review = true;

    data.questions[0].response = {
      question_version_id: "q1",
      selected_option_ids: ["q1-a"],
      text_response: null,
      is_submitted: true,
      answered_at: "2026-11-23T00:00:00Z",
    };

    data.questions[1].response = {
      question_version_id: "q2",
      selected_option_ids: ["q2-a"],
      text_response: null,
      is_submitted: false,
      answered_at: "2026-11-23T00:00:00Z",
    };

    vi.mocked(getExam).mockResolvedValue(data);

    await loadCard();

    expect(questionButton(1, true))
      .toHaveAccessibleDescription("Submitted");

    expect(questionButton(2))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    expect(questionButton(3))
      .toHaveAccessibleDescription("Unanswered");

    expectProgress(1);
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("does not disclose deferred correctness through state indicators", async () => {
    vi.mocked(submitAnswer).mockResolvedValueOnce({
      question_version_id: "q1",
      is_submitted: true,
      feedback_released: false,
      is_correct: true,
      correct_option_ids: ["q1-a"],
      explanation: "Hidden explanation",
    });

    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1))
        .toHaveAccessibleDescription("Submitted");
    });

    expect(
      screen.queryByText("Correct answer."),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText("Incorrect answer."),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText("Hidden explanation"),
    ).not.toBeInTheDocument();

    expectProgress(1);

    await user.click(questionButton(3));
    await user.click(questionButton(1));

    expect(questionButton(1))
      .toHaveAccessibleDescription("Submitted");

    expect(
      screen.queryByText("Hidden explanation"),
    ).not.toBeInTheDocument();
  });

  it("counts an incorrect immediate-feedback answer as submitted", async () => {
    vi.mocked(submitAnswer).mockResolvedValueOnce({
      question_version_id: "q1",
      is_submitted: true,
      feedback_released: true,
      is_correct: false,
      correct_option_ids: ["q1-b"],
      explanation: "Released explanation",
    });

    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await screen.findByText("Incorrect answer.");

    expect(questionButton(1))
      .toHaveAccessibleDescription("Submitted");

    expectProgress(1);
  });
});

describe("JHEP-106 mobile question states", () => {
  it("displays the same response, flag and current states as desktop", async () => {
    const user = userEvent.setup();

    await loadCard();

    await user.click(
      screen.getByRole("button", {
        name: "First choice",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Flag for Review",
      }),
    );

    await screen.findByRole("button", {
      name: "Remove Flag",
    });

    expect(questionButton(1, true))
      .toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

    await user.click(mobileTrigger());

    expect(
      mobileDialog().getByRole("button", {
        name: "Question 1, flagged for review",
        current: "step",
      }),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    expect(
      mobileDialog().getByRole("progressbar"),
    ).toHaveAttribute(
      "aria-valuetext",
      "0 of 3 questions submitted",
    );

    await user.click(
      mobileDialog().getByRole("button", {
        name: "Question 2",
      }),
    );

    expect(
      screen.queryByRole("dialog"),
    ).not.toBeInTheDocument();

    expect(mobileTrigger()).toHaveFocus();

    expect(questionButton(2))
      .toHaveAttribute("aria-current", "step");

    await user.click(mobileTrigger());

    await user.click(
      mobileDialog().getByRole("button", {
        name: "Question 1, flagged for review",
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Submit answer",
      }),
    );

    await waitFor(() => {
      expect(questionButton(1, true))
        .toHaveAccessibleDescription("Submitted");
    });

    expectProgress(1);

    await user.click(mobileTrigger());

    expect(
      mobileDialog().getByRole("button", {
        name: "Question 1, flagged for review",
        current: "step",
      }),
    ).toHaveAccessibleDescription("Submitted");

    expect(
      mobileDialog().getByRole("progressbar"),
    ).toHaveAttribute(
      "aria-valuetext",
      "1 of 3 questions submitted",
    );

    expect(
      mobileDialog().getByRole("region", {
        name: "Question state legend",
      }),
    ).toBeInTheDocument();
  });

  it("retains long-exam scroll position and restores focus", async () => {
    const user = userEvent.setup();

    const questionStates: QuestionState[] =
      Array.from({ length: 100 }, (_, index) => ({
        questionId: `q${index + 1}`,
        responseState:
          index < 20 ? "submitted" : "unanswered",
        isFlagged: index === 99,
        isCurrent: index === 98,
      }));

    render(
      <MobileQuestionNavigation
        totalQuestions={100}
        currentQuestionIndex={98}
        questionStates={questionStates}
        onNavigate={() => true}
      />,
    );

    const trigger = mobileTrigger();

    trigger.focus();
    await user.keyboard("{Enter}");

    const close = mobileDialog().getByRole("button", {
      name: "Close question navigation",
    });

    expect(close).toHaveFocus();

    expect(
      mobileDialog().getByRole("button", {
        name: "Question 99",
        current: "step",
      }),
    ).toHaveAccessibleDescription("Unanswered");

    const lastQuestion = mobileDialog().getByRole(
      "button",
      {
        name: "Question 100, flagged for review",
      },
    );

    expect(lastQuestion)
      .toHaveAccessibleDescription("Unanswered");

    const scrollContainer =
      lastQuestion.closest("ol")?.parentElement;

    if (!scrollContainer) {
      throw new Error("Navigator scroll container missing");
    }

    scrollContainer.scrollTop = 240;

    await user.click(close);

    expect(
      screen.queryByRole("dialog"),
    ).not.toBeInTheDocument();

    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    const reopenedScrollContainer = mobileDialog()
      .getByRole("button", {
        name: "Question 100, flagged for review",
      })
      .closest("ol")?.parentElement;

    expect(reopenedScrollContainer?.scrollTop).toBe(240);

    expect(
      mobileDialog().getByRole("progressbar"),
    ).toHaveAttribute(
      "aria-valuetext",
      "20 of 100 questions submitted",
    );
  });
});