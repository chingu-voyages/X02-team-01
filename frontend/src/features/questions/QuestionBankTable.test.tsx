import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuestionBankTable, {
  formatQuestionStatus,
  shortQuestionId,
} from "./QuestionBankTable";
import type { AdminQuestionBankItem } from "@/types/admin-question-api.types";

const sampleQuestions: AdminQuestionBankItem[] = [
  {
    question_id: "12345678-abcd-efgh-ijkl-1234567890ab",
    question_preview: "What are the three pillars of empiricism?",
    question_type: "multiple_choice",
    category_name: "Empiricism",
    publication_status: "active",
    review_status: "approved",
    last_updated: "2026-03-15T10:00:00Z",
  } as AdminQuestionBankItem,
  {
    question_id: "abcdef12-3456-7890-abcd-ef1234567890",
    question_preview: "Define the Sprint Goal.",
    question_type: "short_answer",
    category_name: null,
    publication_status: "draft",
    review_status: "rejected",
    last_updated: "invalid-date",
  } as AdminQuestionBankItem,
];

describe("QuestionBankTable helpers", () => {
  it("formats status labels accurately across publication and review combinations", () => {
    expect(formatQuestionStatus("retired", "approved")).toBe("Retired");
    expect(formatQuestionStatus("active", "approved")).toBe("Published");
    expect(formatQuestionStatus("draft", "rejected")).toBe("Rejected");
    expect(formatQuestionStatus("draft", "pending")).toBe("Draft");
  });

  it("formats shortQuestionId from the first 8 characters in uppercase", () => {
    expect(shortQuestionId("12345678-abcd-efgh")).toBe("Q-12345678");
  });
});

describe("QuestionBankTable", () => {
  const onPageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders question rows, formatted IDs, types, categories, statuses, dates, and detail links", () => {
    render(
      <QuestionBankTable
        items={sampleQuestions}
        totalCount={2}
        currentPage={1}
        pageCount={1}
        pageSize={10}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("Q-12345678")).toBeTruthy();
    expect(
      screen.getByText("What are the three pillars of empiricism?"),
    ).toBeTruthy();
    expect(screen.getByText("MCQ")).toBeTruthy();
    expect(screen.getByText("Empiricism")).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText("Mar 15, 2026")).toBeTruthy();

    expect(screen.getByText("Q-ABCDEF12")).toBeTruthy();
    expect(screen.getByText("Define the Sprint Goal.")).toBeTruthy();
    expect(screen.getByText("Short")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("—", { selector: "td:nth-child(7)" })).toBeTruthy();

    const viewLink = screen.getByRole("link", { name: "View Q-12345678" });
    expect(viewLink.getAttribute("href")).toBe(
      "/admin/questions/12345678-abcd-efgh-ijkl-1234567890ab",
    );
  });

  it("renders empty filter message and 0 range when totalCount is 0", () => {
    render(
      <QuestionBankTable
        items={[]}
        totalCount={0}
        currentPage={1}
        pageCount={1}
        pageSize={10}
        onPageChange={onPageChange}
      />,
    );

    expect(
      screen.getByText("No questions match the current filters."),
    ).toBeTruthy();
    expect(screen.getByText("Showing 0–0 of 0 questions")).toBeTruthy();
  });

  it("handles pagination controls and disables boundary buttons appropriately", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QuestionBankTable
        items={sampleQuestions}
        totalCount={25}
        currentPage={1}
        pageCount={3}
        pageSize={10}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("Showing 1–10 of 25 questions")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();

    const prevButton = screen.getByRole("button", {
      name: "Previous page",
    }) as HTMLButtonElement;
    const nextButton = screen.getByRole("button", {
      name: "Next page",
    }) as HTMLButtonElement;

    expect(prevButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(false);

    await user.click(nextButton);
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <QuestionBankTable
        items={sampleQuestions}
        totalCount={25}
        currentPage={3}
        pageCount={3}
        pageSize={10}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText("Showing 21–25 of 25 questions")).toBeTruthy();
    expect(prevButton.disabled).toBe(false);
    expect(nextButton.disabled).toBe(true);

    await user.click(prevButton);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});