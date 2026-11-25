import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ResultCard from "./ResultCard";

describe("ResultCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders header metadata, derived total questions, and next step actions", async () => {
    const user = userEvent.setup();
    const onReviewAnswers = vi.fn();

    render(
      <ResultCard
        scorePercent={80}
        correctCount={20}
        incorrectCount={5}
        isPassed={false}
        passingScorePercent={85}
        categoryTitle="Scrum Master"
        onReviewAnswers={onReviewAnswers}
      />,
    );

    expect(screen.getByText("Scrum Master · Practice Exam")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Practice exam complete" }),
    ).toBeTruthy();

    // Total questions derived from correctCount + incorrectCount (20 + 5 = 25)
    expect(screen.getByText("25")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Review Answers" }));
    expect(onReviewAnswers).toHaveBeenCalledTimes(1);
  });
});
