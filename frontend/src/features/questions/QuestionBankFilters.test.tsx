import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuestionBankFilters from "./QuestionBankFilters";

describe("QuestionBankFilters", () => {
  const onSearchChange = vi.fn();
  const onQuestionTypeChange = vi.fn();
  const onStatusFilterChange = vi.fn();
  const onCategoryFilterChange = vi.fn();

  const defaultProps = {
    search: "",
    questionType: "all",
    statusFilter: "all",
    categoryFilter: "all",
    categories: ["Empiricism", "Scrum Events"],
    onSearchChange,
    onQuestionTypeChange,
    onStatusFilterChange,
    onCategoryFilterChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders search input and all filter dropdowns with dynamic categories", () => {
    render(<QuestionBankFilters {...defaultProps} />);

    expect(
      screen.getByPlaceholderText("Search by question or ID"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Question type")).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();

    const categorySelect = screen.getByLabelText("Category");
    expect(categorySelect).toBeTruthy();
    expect(screen.getByRole("option", { name: "Empiricism" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Scrum Events" })).toBeTruthy();
  });

  it("calls onSearchChange when typing in the search field", () => {
    render(<QuestionBankFilters {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText("Search by question or ID");
    fireEvent.change(searchInput, { target: { value: "sprint" } });

    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith("sprint");
  });

  it("calls onQuestionTypeChange, onStatusFilterChange, and onCategoryFilterChange on selection", async () => {
    const user = userEvent.setup();

    render(<QuestionBankFilters {...defaultProps} />);

    await user.selectOptions(
      screen.getByLabelText("Question type"),
      "multiple_choice",
    );
    expect(onQuestionTypeChange).toHaveBeenCalledWith("multiple_choice");

    await user.selectOptions(screen.getByLabelText("Status"), "Published");
    expect(onStatusFilterChange).toHaveBeenCalledWith("Published");

    await user.selectOptions(
      screen.getByLabelText("Category"),
      "Scrum Events",
    );
    expect(onCategoryFilterChange).toHaveBeenCalledWith("Scrum Events");
  });

  it("reflects controlled filter values", () => {
    render(
      <QuestionBankFilters
        {...defaultProps}
        search="Q-1234"
        questionType="short_answer"
        statusFilter="Draft"
        categoryFilter="Empiricism"
      />,
    );

    expect(
      (screen.getByPlaceholderText("Search by question or ID") as HTMLInputElement)
        .value,
    ).toBe("Q-1234");
    expect(
      (screen.getByLabelText("Question type") as HTMLSelectElement).value,
    ).toBe("short_answer");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe(
      "Draft",
    );
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe(
      "Empiricism",
    );
  });
});