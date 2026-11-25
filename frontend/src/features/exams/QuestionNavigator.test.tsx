import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionNavigator from "./QuestionNavigator";

const getNavigator = () =>
  within(screen.getByRole("navigation", { name: "Question navigation" }));
const getQuestionNumbers = () =>
  within(getNavigator().getByRole("list", { name: "Question numbers" }));

afterEach(cleanup);

describe("QuestionNavigator", () => {
  it("makes every question reachable in 15-question sets, including long exams", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator totalQuestions={100} currentQuestionIndex={0} onNavigate={onNavigate} />,
    );

    expect(getNavigator().getByRole("button", { name: "Previous question set" })).toBeDisabled();
    for (let start = 1; start <= 100; start += 15) {
      const end = Math.min(start + 14, 100);
      const numbers = getQuestionNumbers();
      expect(numbers.getAllByRole("button")).toHaveLength(end - start + 1);
      expect(getNavigator().getByText(`${start}-${end} of 100`)).toBeVisible();
      for (let number = start; number <= end; number++) {
        expect(numbers.getByRole("button", { name: `Question ${number}` })).toBeEnabled();
      }
      if (end < 100) {
        await user.click(getNavigator().getByRole("button", { name: "Next question set" }));
      }
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(getNavigator().getByRole("button", { name: "Next question set" })).toBeDisabled();
    await user.click(getQuestionNumbers().getByRole("button", { name: "Question 100" }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(99);
    await user.click(getNavigator().getByRole("button", { name: "Previous question set" }));
    expect(getQuestionNumbers().getByRole("button", { name: "Question 90" })).toBeEnabled();
  });

  it("announces only the active question as current and updates from props", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <QuestionNavigator totalQuestions={5} currentQuestionIndex={1} onNavigate={onNavigate} />,
    );

    expect(getNavigator().getByRole("button", { name: "Question 2", current: "step" })).toBeInTheDocument();
    expect(getNavigator().getAllByRole("button", { current: "step" })).toHaveLength(1);

    rerender(
      <QuestionNavigator totalQuestions={5} currentQuestionIndex={4} onNavigate={onNavigate} />,
    );

    expect(getNavigator().getByRole("button", { name: "Question 5", current: "step" })).toBeInTheDocument();
    expect(getNavigator().getByRole("button", { name: "Question 2" })).not.toHaveAttribute("aria-current");
  });

  it("follows external question changes without restoring stale browsing pages", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { rerender } = render(
      <QuestionNavigator totalQuestions={50} currentQuestionIndex={0} onNavigate={onNavigate} />,
    );
    await user.click(getNavigator().getByRole("button", { name: "Next question set" }));
    expect(getQuestionNumbers().getByRole("button", { name: "Question 16" })).toBeVisible();
    expect(onNavigate).not.toHaveBeenCalled();

    rerender(<QuestionNavigator totalQuestions={50} currentQuestionIndex={35} onNavigate={onNavigate} />);
    expect(getQuestionNumbers().getByRole("button", { name: "Question 36", current: "step" })).toBeVisible();
    rerender(<QuestionNavigator totalQuestions={50} currentQuestionIndex={0} onNavigate={onNavigate} />);
    expect(getQuestionNumbers().getByRole("button", { name: "Question 1", current: "step" })).toBeVisible();
  });

  it("requests direct navigation using a zero-based question index", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator totalQuestions={10} currentQuestionIndex={0} onNavigate={onNavigate} />,
    );

    await user.click(getNavigator().getByRole("button", { name: "Question 8" }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("supports keyboard focus and activation", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator totalQuestions={3} currentQuestionIndex={0} onNavigate={onNavigate} />,
    );

    await user.tab();
    expect(getNavigator().getByRole("button", { name: "Question 1" })).toHaveFocus();
    await user.tab();
    expect(getNavigator().getByRole("button", { name: "Question 2" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("disables all navigation, including paging, while an exam operation is pending", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator totalQuestions={20} currentQuestionIndex={0} disabled onNavigate={onNavigate} />,
    );

    for (const button of getNavigator().getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    await user.click(getNavigator().getByRole("button", { name: "Question 3" }));
    await user.click(getNavigator().getByRole("button", { name: "Next question set" }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(getNavigator().getByText("1-15 of 20")).toBeVisible();
  });

  it("does not invent questions for an empty attempt", () => {
    render(<QuestionNavigator totalQuestions={0} currentQuestionIndex={0} onNavigate={vi.fn()} />);
    expect(getNavigator().queryAllByRole("button")).toHaveLength(0);
  });
});
