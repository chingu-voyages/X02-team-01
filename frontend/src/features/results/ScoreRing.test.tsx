import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ScoreRing from "./ScoreRing";

describe("ScoreRing", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the rounded score percentage and YOUR SCORE label in large mode", () => {
    const { container } = render(
      <ScoreRing scorePercent={80.4} passingScorePercent={85} size="large" />,
    );

    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("Your score")).toBeTruthy();

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("196");
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("renders a compact ring without the sub-label or pass marker tick", () => {
    const { container } = render(
      <ScoreRing scorePercent={92} passingScorePercent={85} size="compact" />,
    );

    expect(screen.getByText("92%")).toBeTruthy();
    expect(screen.queryByText("Your score")).toBeNull();

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("84");
    expect(container.querySelector("line")).toBeNull();
  });

  it("renders an em dash and omits the progress arc when scorePercent is null", () => {
    const { container } = render(
      <ScoreRing scorePercent={null} passingScorePercent={null} />,
    );

    expect(screen.getByText("—")).toBeTruthy();
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("line")).toBeNull();
  });
});
