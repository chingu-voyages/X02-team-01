import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionNavigator from "./QuestionNavigator";

const getNavigator = () =>
  within(screen.getByRole("navigation", { name: "Question navigation" }));

afterEach(cleanup);

describe("QuestionNavigator", () => {
  it("renders every question in the active attempt, including long exams", () => {
    render(
      <QuestionNavigator
        totalQuestions={100}
        currentQuestionIndex={0}
        onNavigate={vi.fn()}
      />,
    );

    expect(getNavigator().getAllByRole("button")).toHaveLength(100);
    expect(getNavigator().getByRole("button", { name: "Question 100" })).toBeEnabled();
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

  it("disables all navigation while an exam operation is pending", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator totalQuestions={3} currentQuestionIndex={0} disabled onNavigate={onNavigate} />,
    );

    for (const button of getNavigator().getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    await user.click(getNavigator().getByRole("button", { name: "Question 3" }));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not invent questions for an empty attempt", () => {
    render(<QuestionNavigator totalQuestions={0} currentQuestionIndex={0} onNavigate={vi.fn()} />);
    expect(getNavigator().queryAllByRole("button")).toHaveLength(0);
  });
});
