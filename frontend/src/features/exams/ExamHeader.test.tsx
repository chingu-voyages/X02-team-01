import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamHeader from "./ExamHeader";

describe("ExamHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the category eyebrow and two-tone question counter", () => {
    render(
      <ExamHeader
        categoryTitle="Agile Fundamentals"
        questionIndex={11}
        totalQuestions={25}
      />,
    );

    expect(screen.getByText("Agile Fundamentals · Practice Exam")).toBeTruthy();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Question 12");
    expect(heading.textContent).toContain("of 25");
  });

  it("moves focus to the heading when questionIndex changes after initial mount", () => {
    const { rerender } = render(
      <ExamHeader
        categoryTitle="Agile Fundamentals"
        questionIndex={0}
        totalQuestions={25}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(document.activeElement).not.toBe(heading);

    rerender(
      <ExamHeader
        categoryTitle="Agile Fundamentals"
        questionIndex={1}
        totalQuestions={25}
      />,
    );

    expect(document.activeElement).toBe(heading);
  });

  it("renders the flag button, announces status, and fires onToggleFlag", async () => {
    const user = userEvent.setup();
    const onToggleFlag = vi.fn();

    render(
      <ExamHeader
        categoryTitle="Agile Fundamentals"
        questionIndex={3}
        totalQuestions={25}
        canToggleFlag
        isFlagged={false}
        onToggleFlag={onToggleFlag}
      />,
    );

    const button = screen.getByRole("button", { name: "Flag for Review" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Not flagged");

    await user.click(button);
    expect(onToggleFlag).toHaveBeenCalledTimes(1);
  });

  it("reflects flagged state, saving state, and displays flagError alert", () => {
    render(
      <ExamHeader
        categoryTitle="Agile Fundamentals"
        questionIndex={3}
        totalQuestions={25}
        canToggleFlag
        isFlagged
        isSavingFlag
        flagError="Unable to save flag."
        onToggleFlag={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Flagged for Review" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(
      "Saving review flag...",
    );
    expect(screen.getByRole("alert").textContent).toBe("Unable to save flag.");
  });
});