import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import StatTile from "./StatTile";

describe("StatTile", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    { variant: "correct" as const, label: "Correct", count: 20 },
    { variant: "incorrect" as const, label: "Incorrect", count: 5 },
    { variant: "questions" as const, label: "Questions", count: 25 },
  ])("renders $label label with count $count", ({ variant, label, count }) => {
    render(<StatTile variant={variant} count={count} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(String(count))).toBeTruthy();
  });
});