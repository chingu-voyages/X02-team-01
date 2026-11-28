import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { QuestionResult } from "@/types/exam-api.types";
import QuestionResultsList from "./QuestionResultsList";

function essay(overrides: Partial<QuestionResult> = {}): QuestionResult {
  return {
    attempt_id: "attempt", question_version_id: "essay", position: 1,
    question_text: "Explain your approach.", response_type: "essay", outcome: "ungraded",
    status: "pending_manual_grading", points_earned: 0, max_points: 2,
    feedback: null, learner_response: "  First paragraph.\n\nSecond paragraph.  ",
    ...overrides,
  };
}

afterEach(cleanup);

describe("JHEP-120 readable essay results", () => {
  it("retains exact paragraphs and wrapping styles without inventing a score", () => {
    const item = essay();
    render(<QuestionResultsList questions={[item]} />);
    const region = within(screen.getByRole("region", { name: "Question breakdown" }));
    const response = region.getByText(/^Your response:/);
    expect(response.textContent).toBe(`Your response: ${item.learner_response}`);
    expect(response).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
    expect(region.getByText("Awaiting manual review")).toBeInTheDocument();
    expect(region.queryByText(/^Score:/)).not.toBeInTheDocument();
  });

  it("renders markup-looking answers and feedback as text, not executable elements", () => {
    const { container } = render(<QuestionResultsList questions={[essay({
      status: "graded", outcome: "manually_graded", points_earned: 1,
      learner_response: '<script>alert("x")</script>\n<img src=x onerror=alert(1)>',
      feedback: "<strong>Feedback</strong>\nSecond paragraph.",
    })]} />);
    expect(container.querySelector("script, img, strong")).toBeNull();
    expect(screen.getByText(/^Your response:/).textContent).toContain('<script>alert("x")</script>');
    expect(screen.getByText(/^Feedback:/)).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
    expect(screen.getByText("Score: 1/2")).toBeInTheDocument();
  });

  it("does not present unavailable grading as failure or a zero grade", () => {
    render(<QuestionResultsList questions={[essay({ status: "unavailable", outcome: "ungradable" })]} />);
    expect(screen.getByText("Not graded")).toBeInTheDocument();
    expect(screen.getByText(/not counted as a failure/)).toBeInTheDocument();
    expect(screen.queryByText(/^Score:/)).not.toBeInTheDocument();
  });

  it("preserves an unbroken long response in a shrinkable results card", () => {
    const value = "word".repeat(1000);
    render(<QuestionResultsList questions={[essay({ learner_response: value })]} />);
    expect(screen.getByText(/^Your response:/).textContent).toBe(`Your response: ${value}`);
    expect(screen.getByRole("region", { name: "Question breakdown" })).toHaveClass("min-w-0");
    expect(screen.getByRole("listitem")).toHaveClass("min-w-0");
  });
});
