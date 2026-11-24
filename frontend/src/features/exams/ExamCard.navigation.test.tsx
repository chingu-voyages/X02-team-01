import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import ExamCard from "./ExamCard";
import MobileQuestionNavigation from "./MobileQuestionNavigation";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt } from "@/types/exam-api.types";

const { handleError, replace, logout } = vi.hoisted(() => ({
  handleError: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "test-token", ready: true, handleError }),
  useAuth: () => ({ logout }),
}));
vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/questions/OptionItem", () => ({
  default: ({ option, isSelected, isSubmitted, onSelect }: {
    option: string;
    isSelected: boolean;
    isSubmitted: boolean;
    onSelect: () => void;
  }) => (
    <button type="button" aria-pressed={isSelected} disabled={isSubmitted} onClick={onSelect}>
      {option}
    </button>
  ),
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const thirdQuestionId = "44444444-4444-4444-8444-444444444444";

function attempt(): ExamAttempt {
  return {
    attempt_id: attemptId,
    certification_id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress",
    current_position: 1,
    question_count: 3,
    questions: [
      {
        id: questionId,
        position: 1,
        question_text: "First question",
        question_type: "multiple_choice",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [{ id: optionId, position: 1, option_text: "First choice" }],
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        position: 2,
        question_text: "Second question",
        question_type: "short_answer",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [],
      },
      {
        id: thirdQuestionId,
        position: 3,
        question_text: "Third question",
        question_type: "multiple_choice",
        allows_multiple_answers: false,
        difficulty: "easy",
        images: [],
        options: [{ id: "77777777-7777-4777-8777-777777777777", position: 1, option_text: "Third choice" }],
      },
    ],
  };
}

function questionButton(number: number) {
  return within(screen.getByRole("navigation", { name: "Question navigation" }))
    .getByRole("button", { name: `Question ${number}` });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getExam).mockResolvedValue(attempt());
});
afterEach(cleanup);

describe("ExamCard numbered navigation", () => {
  it("jumps directly and retains unsubmitted option selections and short answers without API writes", async () => {
    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));

    await user.click(questionButton(3));
    expect(screen.getByRole("heading", { name: "Third question" })).toBeInTheDocument();
    expect(questionButton(3)).toHaveAttribute("aria-current", "step");
    await user.click(questionButton(2));
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "My draft answer");
    await user.click(questionButton(1));
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    await user.click(questionButton(2));
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("My draft answer");

    expect(getExam).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("retains a locked submitted answer without revealing deferred feedback when revisited", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: false,
    });
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled());

    await user.click(questionButton(3));
    await user.click(questionButton(1));
    expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer.")).not.toBeInTheDocument();
    expect(screen.getByText("Submitted answers: 1 / 3")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("keeps released immediate feedback associated with its original question", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: true,
      is_correct: true,
      correct_option_ids: [optionId],
      explanation: "Feedback for question one.",
    });
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await screen.findByText("Correct answer.");

    await user.click(questionButton(3));
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument();
    expect(screen.queryByText("Feedback for question one.")).not.toBeInTheDocument();
    await user.click(questionButton(1));
    expect(screen.getByText("Correct answer.")).toBeInTheDocument();
    expect(screen.getByText("Feedback for question one.")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});


// jsdom versions without native dialog methods need a minimal open/close
// shim. The real browser provides modal focus trapping and Escape handling.
const dialogPrototype = HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, "close");

beforeAll(() => {
  if (typeof dialogPrototype.showModal !== "function") {
    Object.defineProperty(dialogPrototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.open = true; },
    });
  }
  if (typeof dialogPrototype.close !== "function") {
    Object.defineProperty(dialogPrototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.open = false; },
    });
  }
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(dialogPrototype, "showModal", originalShowModal);
  } else {
    Reflect.deleteProperty(dialogPrototype, "showModal");
  }
  if (originalClose) {
    Object.defineProperty(dialogPrototype, "close", originalClose);
  } else {
    Reflect.deleteProperty(dialogPrototype, "close");
  }
});

function mobileTrigger() {
  return screen.getByRole("button", { name: /^Question Navigation/ });
}

function mobileDialog() {
  return screen.getByRole("dialog", { name: "Question Navigation" });
}

function mobileQuestion(number: number) {
  return within(mobileDialog()).getByRole("button", { name: `Question ${number}` });
}

async function jumpOnMobile(user: ReturnType<typeof userEvent.setup>, number: number) {
  await user.click(mobileTrigger());
  await user.click(mobileQuestion(number));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
}

describe("MobileQuestionNavigation", () => {
  it("opens by keyboard with the current step, and closes with focus returned", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn(() => true);
    const previousOverflow = document.body.style.overflow;
    render(<MobileQuestionNavigation totalQuestions={12} currentQuestionIndex={3} onNavigate={onNavigate} />);

    const trigger = mobileTrigger();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(mobileDialog()).toHaveAttribute("open");
    expect(mobileDialog()).toHaveAttribute("aria-modal", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(mobileQuestion(4)).toHaveAttribute("aria-current", "step");
    expect(document.body.style.overflow).toBe("hidden");
    const close = within(mobileDialog()).getByRole("button", { name: "Close question navigation" });
    expect(close).toHaveFocus();
    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe(previousOverflow);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("closes on the native cancel event used by Escape without navigating", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn(() => true);
    render(<MobileQuestionNavigation totalQuestions={5} currentQuestionIndex={0} onNavigate={onNavigate} />);
    const trigger = mobileTrigger();
    await user.click(trigger);
    // Real Escape dispatches cancel in the browser; jsdom may not do so.
    fireEvent(mobileDialog(), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("closes only after the requested question is accepted", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn<(index: number) => boolean>()
      .mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MobileQuestionNavigation totalQuestions={5} currentQuestionIndex={0} onNavigate={onNavigate} />);
    await user.click(mobileTrigger());
    await user.click(mobileQuestion(5));
    expect(onNavigate).toHaveBeenLastCalledWith(4);
    expect(mobileDialog()).toBeInTheDocument();
    await user.click(mobileQuestion(3));
    expect(onNavigate).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mobileTrigger()).toHaveFocus();
  });

  it("renders long attempts and restores navigator scroll position when reopened", async () => {
    const user = userEvent.setup();
    render(<MobileQuestionNavigation totalQuestions={100} currentQuestionIndex={98} onNavigate={() => true} />);
    await user.click(mobileTrigger());
    expect(mobileQuestion(100)).toBeInTheDocument();
    expect(mobileQuestion(99)).toHaveAttribute("aria-current", "step");
    const scroll = within(mobileDialog()).getByRole("list").parentElement!;
    scroll.scrollTop = 240;
    await user.click(within(mobileDialog()).getByRole("button", { name: "Close question navigation" }));
    await user.click(mobileTrigger());
    expect(within(mobileDialog()).getByRole("list").parentElement!.scrollTop).toBe(240);
  });

  it("blocks navigation while a submission is pending and keeps Close available", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn(() => true);
    const { rerender } = render(<MobileQuestionNavigation totalQuestions={5} currentQuestionIndex={0} onNavigate={onNavigate} />);
    await user.click(mobileTrigger());
    rerender(<MobileQuestionNavigation totalQuestions={5} currentQuestionIndex={0} disabled onNavigate={onNavigate} />);
    expect(mobileQuestion(2)).toBeDisabled();
    await user.click(mobileQuestion(2));
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(within(mobileDialog()).getByRole("button", { name: "Close question navigation" }));
    expect(mobileTrigger()).toBeDisabled();
  });
});

describe("ExamCard mobile navigation integration", () => {
  it("jumps directly and retains option and text drafts without any submission", async () => {
    const user = userEvent.setup();
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await jumpOnMobile(user, 3);
    expect(screen.getByRole("heading", { name: "Third question" })).toBeInTheDocument();
    await jumpOnMobile(user, 2);
    await user.type(screen.getByRole("textbox", { name: "Your answer" }), "Mobile draft");
    await jumpOnMobile(user, 1);
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    await jumpOnMobile(user, 2);
    expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("Mobile draft");
    expect(getExam).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(submitExam).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps submitted answers locked and does not reveal deferred correctness", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({
      question_version_id: questionId,
      is_submitted: true,
      feedback_released: false,
    });
    render(<ExamCard attemptId={attemptId} />);
    await screen.findByRole("heading", { name: "First question" });
    await user.click(screen.getByRole("button", { name: "First choice" }));
    await user.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled());
    await jumpOnMobile(user, 3);
    await jumpOnMobile(user, 1);
    expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument();
    expect(screen.queryByText("Incorrect answer.")).not.toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(submitExam).not.toHaveBeenCalled();
  });
});
