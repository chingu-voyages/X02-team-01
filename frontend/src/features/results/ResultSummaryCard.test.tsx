import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ResultSummaryCard from "./ResultSummaryCard";

describe("ResultSummaryCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Fail summary, missing correct answers count, and stat tiles", () => {
    render(
      <ResultSummaryCard
        scorePercent={80}
        correctCount={20}
        incorrectCount={5}
        totalQuestions={25}
        isPassed={false}
        passingScorePercent={85}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("Fail");
    expect(screen.getByText("Not passed")).toBeTruthy();
    expect(screen.getByText("Score 80%")).toBeTruthy();
    expect(screen.getByText("Pass mark 85%")).toBeTruthy();
    expect(
      screen.getByText(/You're 2 correct answers away from the pass mark/),
    ).toBeTruthy();

    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
  });

  it("uses singular grammar when only 1 correct answer is needed to pass", () => {
    render(
      <ResultSummaryCard
        scorePercent={80}
        correctCount={8}
        incorrectCount={2}
        totalQuestions={10}
        isPassed={false}
        passingScorePercent={85}
      />,
    );

    expect(
      screen.getByText(/You're 1 correct answer away from the pass mark/),
    ).toBeTruthy();
  });

  it("renders the Pass summary and positive guidance copy", () => {
    render(
      <ResultSummaryCard
        scorePercent={92}
        correctCount={23}
        incorrectCount={2}
        totalQuestions={25}
        isPassed
        passingScorePercent={85}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("Pass");
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(
      screen.getByText(
        "Great work — you cleared the pass mark. Review the explanations to lock in what you learned.",
      ),
    ).toBeTruthy();
  });

  it("renders the Not assessed fallback when scorePercent or isPassed is null", () => {
    render(
      <ResultSummaryCard
        scorePercent={null}
        correctCount={0}
        incorrectCount={0}
        totalQuestions={0}
        isPassed={null}
        passingScorePercent={null}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("Not assessed");
    expect(screen.getByText("Score unavailable")).toBeTruthy();
    expect(
      screen.getByText(
        "No automatically graded score is available for this attempt. This does not mean the exam was failed.",
      ),
    ).toBeTruthy();
  });
});