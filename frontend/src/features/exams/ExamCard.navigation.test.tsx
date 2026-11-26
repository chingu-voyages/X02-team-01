import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import ExamCard from "./ExamCard";
import ExamSidebar from "./ExamSidebar";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt } from "@/types/exam-api.types";

const { handleError, replace, logout } = vi.hoisted(() => ({ handleError: vi.fn(), replace: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn(), setQuestionFlag: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "test-token", ready: true, handleError }),
  useAuth: () => ({ logout }),
}));
vi.mock("@/components/ui/radio-group", () => ({ RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/features/questions/OptionItem", () => ({
  default: ({ option, isSelected, isSubmitted, disabled, onSelect }: {
    option: string; isSelected: boolean; isSubmitted: boolean; disabled?: boolean; onSelect: () => void;
  }) => <button type="button" aria-pressed={isSelected} disabled={isSubmitted || disabled} onClick={onSelect}>{option}</button>,
}));

const attemptId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333";
const thirdQuestionId = "44444444-4444-4444-8444-444444444444";
function attempt(): ExamAttempt {
  return {
    attempt_id: attemptId, certification_id: "55555555-5555-4555-8555-555555555555",
    status: "in_progress", current_position: 1, question_count: 3,
    questions: [
      { id: questionId, position: 1, question_text: "First question", question_type: "multiple_choice", allows_multiple_answers: false, difficulty: "easy", images: [], options: [{ id: optionId, position: 1, option_text: "First choice" }] },
      { id: "66666666-6666-4666-8666-666666666666", position: 2, question_text: "Second question", question_type: "short_answer", allows_multiple_answers: false, difficulty: "easy", images: [], options: [] },
      { id: thirdQuestionId, position: 3, question_text: "Third question", question_type: "multiple_choice", allows_multiple_answers: false, difficulty: "easy", images: [], options: [{ id: "77777777-7777-4777-8777-777777777777", position: 1, option_text: "Third choice" }] },
    ],
  };
}
function desktop() { return within(screen.getByRole("complementary", { name: "Question navigation sidebar" })); }
function questionButton(number: number) { return desktop().getByRole("button", { name: `Question ${number}` }); }
function mobileTrigger() { return screen.getByRole("button", { name: /^Question navigation/i }); }
function mobilePanel() { return within(screen.getByRole("region", { name: "Mobile question navigation" })); }
function mobileQuestion(number: number) { return mobilePanel().getByRole("button", { name: `Question ${number}` }); }
async function jumpOnMobile(user: ReturnType<typeof userEvent.setup>, number: number) {
  await user.click(mobileTrigger());
  expect(mobileTrigger()).toHaveAttribute("aria-expanded", "true");
  await user.click(mobileQuestion(number));
  expect(mobileTrigger()).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region", { name: "Mobile question navigation" })).not.toBeInTheDocument();
}
function mobileProps(overrides: Partial<ComponentProps<typeof ExamSidebar>> = {}): ComponentProps<typeof ExamSidebar> {
  return { currentQuestion: attempt().questions[0], totalQuestions: 5, currentQuestionIndex: 0, isSubmitted: false, isSubmitting: false, isFinishing: false, allQuestionsSubmitted: false, finishError: "", variant: "mobile", onNavigate: vi.fn(() => true), onFinish: vi.fn(), ...overrides };
}
async function loadCard() { render(<ExamCard attemptId={attemptId} />); await screen.findByRole("heading", { name: "First question" }); }
async function submitFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "First choice" }));
  await user.click(screen.getByRole("button", { name: "Submit answer" }));
  await waitFor(() => expect(questionButton(1)).toHaveAccessibleDescription("Submitted"));
  expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getExam).mockResolvedValue(attempt()); });
afterEach(cleanup);

describe("ExamCard numbered navigation", () => {
  it("jumps directly and retains unsubmitted option selections and short answers without API writes", async () => {
    const user = userEvent.setup();
    await loadCard();
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
    expect(submitAnswer).not.toHaveBeenCalled(); expect(submitExam).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });
  it("retains a locked submitted answer without revealing deferred feedback when revisited", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({ question_version_id: questionId, is_submitted: true, feedback_released: false });
    await loadCard(); await submitFirst(user);
    await user.click(questionButton(3)); await user.click(questionButton(1));
    expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument(); expect(screen.queryByText("Incorrect answer.")).not.toBeInTheDocument();
    expect(desktop().getByText("Submitted answers: 1 / 3")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1); expect(submitExam).not.toHaveBeenCalled();
  });
  it("keeps released immediate feedback associated with its original question", async () => {
    const user = userEvent.setup();
    vi.mocked(submitAnswer).mockResolvedValue({ question_version_id: questionId, is_submitted: true, feedback_released: true, is_correct: true, correct_option_ids: [optionId], explanation: "Feedback for question one." });
    await loadCard(); await submitFirst(user); await screen.findByText("Correct answer.");
    await user.click(questionButton(3));
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument(); expect(screen.queryByText("Feedback for question one.")).not.toBeInTheDocument();
    await user.click(questionButton(1));
    expect(screen.getByText("Correct answer.")).toBeInTheDocument(); expect(screen.getByText("Feedback for question one.")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("ExamSidebar mobile disclosure", () => {
  it("opens and closes by keyboard with the current step and keeps focus on the trigger", async () => {
    const user = userEvent.setup(); const onNavigate = vi.fn(() => true);
    const overflow = document.body.style.overflow;
    render(<ExamSidebar {...mobileProps({ totalQuestions: 12, currentQuestionIndex: 3, onNavigate })} />);
    const trigger = mobileTrigger(); trigger.focus(); await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true"); expect(trigger).toHaveFocus();
    expect(mobileQuestion(4)).toHaveAttribute("aria-current", "step");
    expect(document.body.style.overflow).toBe(overflow);
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false"); expect(trigger).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Mobile question navigation" })).not.toBeInTheDocument(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("closes on Escape from a question tile and restores focus without navigating", async () => {
    const user = userEvent.setup(); const onNavigate = vi.fn(() => true);
    render(<ExamSidebar {...mobileProps({ onNavigate })} />);
    const trigger = mobileTrigger(); await user.click(trigger); mobileQuestion(2).focus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false"); expect(trigger).toHaveFocus(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("closes only after the requested question is accepted", async () => {
    const user = userEvent.setup(); const onNavigate = vi.fn<(index: number) => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ExamSidebar {...mobileProps({ onNavigate })} />);
    await user.click(mobileTrigger()); await user.click(mobileQuestion(5));
    expect(onNavigate).toHaveBeenLastCalledWith(4); expect(mobileTrigger()).toHaveAttribute("aria-expanded", "true");
    await user.click(mobileQuestion(3));
    expect(onNavigate).toHaveBeenLastCalledWith(2); expect(mobileTrigger()).toHaveAttribute("aria-expanded", "false"); expect(mobileTrigger()).toHaveFocus();
  });
  it("supports long attempts and reopens on the active question set after browsing", async () => {
    const user = userEvent.setup(); const onNavigate = vi.fn(() => true);
    render(<ExamSidebar {...mobileProps({ totalQuestions: 100, currentQuestionIndex: 98, onNavigate })} />);
    await user.click(mobileTrigger());
    expect(mobileQuestion(100)).toBeInTheDocument(); expect(mobileQuestion(99)).toHaveAttribute("aria-current", "step");
    await user.click(mobilePanel().getByRole("button", { name: "Previous question set" }));
    expect(mobileQuestion(90)).toBeInTheDocument();
    await user.click(mobileTrigger()); await user.click(mobileTrigger());
    expect(mobileQuestion(99)).toHaveAttribute("aria-current", "step"); expect(mobileQuestion(100)).toBeEnabled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it("blocks question navigation during submission but keeps the disclosure closable", async () => {
    const user = userEvent.setup(); const onNavigate = vi.fn(() => true); const props = mobileProps({ onNavigate });
    const { rerender } = render(<ExamSidebar {...props} />); await user.click(mobileTrigger());
    rerender(<ExamSidebar {...props} isSubmitting />);
    expect(mobileQuestion(2)).toBeDisabled(); await user.click(mobileQuestion(2)); expect(onNavigate).not.toHaveBeenCalled();
    await user.click(mobileTrigger()); expect(mobileTrigger()).toHaveAttribute("aria-expanded", "false");
    rerender(<ExamSidebar {...props} />); await user.click(mobileTrigger()); expect(mobileQuestion(2)).toBeEnabled();
  });
});

describe("ExamCard mobile navigation integration", () => {
  it("jumps directly and retains option and text drafts without any submission", async () => {
    const user = userEvent.setup(); await loadCard(); await user.click(screen.getByRole("button", { name: "First choice" }));
    await jumpOnMobile(user, 3); expect(screen.getByRole("heading", { name: "Third question" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    await jumpOnMobile(user, 2); await user.type(screen.getByRole("textbox", { name: "Your answer" }), "Mobile draft");
    await jumpOnMobile(user, 1); expect(screen.getByRole("button", { name: "First choice" })).toHaveAttribute("aria-pressed", "true");
    await jumpOnMobile(user, 2); expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("Mobile draft");
    expect(getExam).toHaveBeenCalledTimes(1); expect(submitAnswer).not.toHaveBeenCalled(); expect(submitExam).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });
  it("keeps submitted answers locked and does not reveal deferred correctness", async () => {
    const user = userEvent.setup(); vi.mocked(submitAnswer).mockResolvedValue({ question_version_id: questionId, is_submitted: true, feedback_released: false });
    await loadCard(); await submitFirst(user); await jumpOnMobile(user, 3); await jumpOnMobile(user, 1);
    expect(screen.getByRole("button", { name: "First choice" })).toBeDisabled();
    expect(screen.queryByText("Correct answer.")).not.toBeInTheDocument(); expect(screen.queryByText("Incorrect answer.")).not.toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledTimes(1); expect(submitExam).not.toHaveBeenCalled();
  });
});
