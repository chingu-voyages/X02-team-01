
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ResultNextSteps from "./ResultNextSteps";

describe("ResultNextSteps", () => {
  afterEach(() => {
    cleanup();
  });

  it("triggers onReviewAnswers when Review Answers is clicked", async () => {
    const user = userEvent.setup();
    const onReviewAnswers = vi.fn();

    render(<ResultNextSteps onReviewAnswers={onReviewAnswers} />);

    const reviewButton = screen.getByRole("button", {
      name: "Review Answers",
    });

    await user.click(reviewButton);

    expect(onReviewAnswers).toHaveBeenCalledTimes(1);
  });

  it("links back to the practice exam selection page", () => {
    render(<ResultNextSteps />);

    const backLink = screen.getByRole("link", {
      name: "Back to practice exams",
    });

    expect(backLink.getAttribute("href")).toBe("/categories");
  });
});
