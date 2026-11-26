import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BrowseExamCard from "./BrowseExamCard";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

const sampleExam: PublishedPracticeExam = {
  id: "exam-1",
  certification_id: "cert-1",
  certification_name: "Agile Certification",
  category_id: "cat-1",
  category_name: "Core Principles",
  name: "Agile Fundamentals",
  question_count: 25,
  available_question_count: 60,
};

describe("BrowseExamCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders featured variant with Recommended badge, exam metadata, and Start exam button", async () => {
    const user = userEvent.setup();
    const onStartExam = vi.fn();

    render(
      <BrowseExamCard
        exam={sampleExam}
        variant="featured"
        isStarting={false}
        onStartExam={onStartExam}
      />,
    );

    const article = screen.getByRole("article", { name: "Agile Fundamentals" });
    expect(article).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(
      screen.getByText("Agile Certification · Core Principles"),
    ).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByText("questions")).toBeTruthy();

    const startButton = screen.getByRole("button", {
      name: "Start exam — Agile Fundamentals",
    });
    await user.click(startButton);
    expect(onStartExam).toHaveBeenCalledWith(sampleExam);
  });

  it("omits the Recommended badge for standard and alt variants", () => {
    const { rerender } = render(
      <BrowseExamCard
        exam={sampleExam}
        variant="standard"
        isStarting={false}
        onStartExam={vi.fn()}
      />,
    );

    expect(screen.queryByText("Recommended")).toBeNull();

    rerender(
      <BrowseExamCard
        exam={sampleExam}
        variant="alt"
        isStarting={false}
        onStartExam={vi.fn()}
      />,
    );

    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("disables the start button and shows Starting... while an attempt is being created", () => {
    render(
      <BrowseExamCard
        exam={sampleExam}
        variant="standard"
        isStarting
        onStartExam={vi.fn()}
      />,
    );

    const startButton = screen.getByRole("button", {
      name: "Start exam — Agile Fundamentals",
    }) as HTMLButtonElement;

    expect(startButton.disabled).toBe(true);
    expect(screen.getByText("Starting...")).toBeTruthy();
  });
});