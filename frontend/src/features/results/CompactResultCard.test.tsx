import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import CompactResultCard from "./CompactResultCard";

describe("CompactResultCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Passed state with score, threshold, and answer breakdown", () => {
    render(
      <CompactResultCard
        scorePercent={92}
        correctCount={23}
        incorrectCount={2}
        isPassed
        passingScorePercent={85}
      />,
    );

    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("92% scored · 85% required")).toBeTruthy();
    expect(screen.getByText("23 correct · 2 incorrect")).toBeTruthy();
  });

  it("renders Not passed state when the exam was failed", () => {
    render(
      <CompactResultCard
        scorePercent={80}
        correctCount={20}
        incorrectCount={5}
        isPassed={false}
        passingScorePercent={85}
      />,
    );

    expect(screen.getByText("Not passed")).toBeTruthy();
    expect(screen.getByText("80% scored · 85% required")).toBeTruthy();
  });

  it("renders Not assessed state when score or pass status is null", () => {
    render(
      <CompactResultCard
        scorePercent={null}
        correctCount={0}
        incorrectCount={0}
        isPassed={null}
        passingScorePercent={null}
      />,
    );

    expect(screen.getByText("Not assessed")).toBeTruthy();
    expect(screen.getByText("Score unavailable")).toBeTruthy();
    expect(screen.getByText("0 correct · 0 incorrect")).toBeTruthy();
  });
});