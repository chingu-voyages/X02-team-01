import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PracticeCategoryCard from "./PracticeCategoryCard";
import type { PracticeCategory } from "@/types/category-api.types";

const mockCategory = {
  id: "cat-1",
  certification_id: "cert-1",
  certification_name: "Professional Scrum Master I",
  name: "Scrum Theory & Empiricism",
  available_question_count: 42,
} as PracticeCategory;

describe("PracticeCategoryCard", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders category details, availability badge, and question count", () => {
    render(
      <PracticeCategoryCard
        category={mockCategory}
        isSelected={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("AVAILABLE")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Scrum Theory & Empiricism" }),
    ).toBeTruthy();
    expect(screen.getByText("Professional Scrum Master I")).toBeTruthy();
    expect(screen.getByText("42 questions available")).toBeTruthy();
  });

  it("renders unselected button state by default", () => {
    render(
      <PracticeCategoryCard
        category={mockCategory}
        isSelected={false}
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole("button", {
      name: "View exam — Scrum Theory & Empiricism",
    });

    expect(button.textContent).toBe("View exam");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.classList.contains("bg-brand-accent")).toBe(false);
    expect(button.classList.contains("bg-brand-surface")).toBe(true);
  });

  it("renders selected styling and label when isSelected is true", () => {
    render(
      <PracticeCategoryCard
        category={mockCategory}
        isSelected={true}
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole("button", {
      name: "View exam — Scrum Theory & Empiricism",
    });
    const card = button.closest("article");

    expect(button.textContent).toBe("Selected");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("bg-brand-accent");
    expect(card?.className).toContain("border-brand-accent");
  });

  it("calls onSelect with the category when clicked", async () => {
    const user = userEvent.setup();

    render(
      <PracticeCategoryCard
        category={mockCategory}
        isSelected={false}
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "View exam — Scrum Theory & Empiricism",
      }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockCategory);
  });
});