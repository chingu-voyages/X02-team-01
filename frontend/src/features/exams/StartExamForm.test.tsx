import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StartExamForm from "./StartExamForm";
import type { PracticeCategory } from "@/types/category-api.types";

const mockCategory = {
  id: "cat-1",
  certification_id: "cert-1",
  certification_name: "Professional Scrum Master I",
  name: "Scrum Events",
  available_question_count: 25,
} as PracticeCategory;

describe("StartExamForm", () => {
  const onQuestionCountChange = vi.fn();
  const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  });
  const onContinueExisting = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders selected category metadata and question count input", () => {
    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Start Scrum Events" }),
    ).toBeTruthy();
    expect(screen.getByText("Professional Scrum Master I")).toBeTruthy();

    const input = screen.getByLabelText(
      "Number of questions",
    ) as HTMLInputElement;
    expect(input.value).toBe("5");
    expect(input.min).toBe("1");
    expect(input.max).toBe("25");
  });

  it("caps max questions at 100 when available_question_count exceeds 100", () => {
    const largeCategory = {
      ...mockCategory,
      available_question_count: 150,
    } as PracticeCategory;

    render(
      <StartExamForm
        category={largeCategory}
        questionCount={10}
        isStarting={false}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    const input = screen.getByLabelText(
      "Number of questions",
    ) as HTMLInputElement;
    expect(input.max).toBe("100");
  });

  it("calls onQuestionCountChange when the input value changes", () => {
    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    const input = screen.getByLabelText("Number of questions");
    fireEvent.change(input, { target: { value: "12" } });

    expect(onQuestionCountChange).toHaveBeenCalledTimes(1);
    expect(onQuestionCountChange).toHaveBeenCalledWith(12);
  });

  it("renders startError alert when provided", () => {
    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError="Unable to start exam."
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Unable to start exam.");
  });

  it("renders existing attempt callout and triggers onContinueExisting", async () => {
    const user = userEvent.setup();

    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError="You already have an unfinished exam for this certification."
        existingAttemptId="123e4567-e89b-12d3-a456-426614174000"
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    const continueButton = screen.getByRole("button", {
      name: "Continue existing exam",
    });
    await user.click(continueButton);

    expect(onContinueExisting).toHaveBeenCalledTimes(1);
  });

  it("hides the existing attempt callout when existingAttemptId is null", () => {
    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Continue existing exam" }),
    ).toBeNull();
  });

  it("submits the form when clicking Start Exam", async () => {
    const user = userEvent.setup();

    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={false}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Exam" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables submit button and shows pending label while isStarting is true", () => {
    render(
      <StartExamForm
        category={mockCategory}
        questionCount={5}
        isStarting={true}
        startError=""
        existingAttemptId={null}
        onQuestionCountChange={onQuestionCountChange}
        onSubmit={onSubmit}
        onContinueExisting={onContinueExisting}
      />,
    );

    const submitButton = screen.getByRole("button", {
      name: "Starting exam...",
    }) as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
  });
});