import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ScoreBar from "./ScoreBar";

describe("ScoreBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders scale labels and positions the fill bar and pass marker", () => {
    const { container } = render(
      <ScoreBar scorePercent={80} passingScorePercent={85} />,
    );

    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("Pass 85%")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();

    const fillBar = container.querySelector(
      ".bg-brand-primary",
    ) as HTMLDivElement;
    expect(fillBar.style.width).toBe("80%");

    const passMarker = container.querySelector(
      ".bg-brand-accent",
    ) as HTMLSpanElement;
    expect(passMarker.style.left).toBe("85%");
  });

  it("clamps out-of-range percentages between 0% and 100%", () => {
    const { container } = render(
      <ScoreBar scorePercent={120} passingScorePercent={-10} />,
    );

    expect(screen.getByText("Pass 0%")).toBeTruthy();

    const fillBar = container.querySelector(
      ".bg-brand-primary",
    ) as HTMLDivElement;
    expect(fillBar.style.width).toBe("100%");

    const passMarker = container.querySelector(
      ".bg-brand-accent",
    ) as HTMLSpanElement;
    expect(passMarker.style.left).toBe("0%");
  });
});