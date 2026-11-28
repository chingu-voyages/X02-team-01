import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import type { ExamAttempt, QuestionFeedback } from "@/types/exam-api.types";
import ExamCard from "./ExamCard";

const { handleError, replace } = vi.hoisted(() => ({ handleError: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession: () => ({ ready: true, token: "token", handleError }) }));
vi.mock("@/lib/exam-api", () => ({ getExam: vi.fn(), submitAnswer: vi.fn(), setQuestionFlag: vi.fn() }));
vi.mock("@/lib/exam-submission", () => ({ submitExam: vi.fn() }));

function attempt(count = 2): ExamAttempt {
  return {
    attempt_id: "attempt", certification_id: "cert", status: "in_progress",
    question_count: count, current_position: 1,
    questions: Array.from({ length: count }, (_, index) => ({
      id: `essay-${index + 1}`, position: index + 1, question_text: `Explain concept ${index + 1}`,
      question_type: "essay" as const, allows_multiple_answers: false, difficulty: "medium" as const,
      options: [], images: [], flagged_for_review: false,
    })),
  };
}
function confirmation(question = "essay-1"): QuestionFeedback {
  return { attempt_id: "attempt", question_version_id: question, is_submitted: true,
    feedback_released: false, is_correct: null, correct_option_ids: null, explanation: null };
}
function field() { return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your essay response" }); }
function controls() { return within(screen.getByRole("group", { name: "Answer and navigation controls" })); }
function navigation() { return within(screen.getByRole("complementary", { name: "Question navigation sidebar" })); }
async function load(data = attempt()) {
  vi.mocked(getExam).mockResolvedValueOnce(data);
  const rendered = render(<ExamCard attemptId="attempt" />);
  await screen.findByRole("textbox", { name: "Your essay response" });
  return rendered;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(submitAnswer).mockImplementation(async (_id, question) => confirmation(question));
  vi.mocked(setQuestionFlag).mockImplementation(async (id, question, flag) => ({ attempt_id: id, question_version_id: question, flagged_for_review: flag }));
});
afterEach(cleanup);

describe("JHEP-120 learner essay experience", () => {
  it("explains entry, the limit, draft retention and why Submit is disabled", async () => {
    await load();
    expect(field()).toBe(screen.getByLabelText("Your essay response"));
    expect(field()).toHaveAccessibleDescription(/Submitting locks this answer/);
    expect(field()).toHaveAccessibleDescription(/submit before refreshing or leaving/);
    expect(screen.getByText("0 / 10,000 characters")).toBeInTheDocument();
    expect(controls().getByRole("button", { name: "Submit answer" })).toBeDisabled();
    expect(screen.getByText("Enter a response to enable Submit answer.")).toBeInTheDocument();
  });

  it("accepts paragraph breaks without submitting on Enter", async () => {
    const user = userEvent.setup();
    await load();
    await user.type(field(), "  First paragraph.{Enter}{Enter}Second paragraph.  ");
    expect(field()).toHaveValue("  First paragraph.\n\nSecond paragraph.  ");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(controls().getByRole("button", { name: "Submit answer" })).toBeEnabled();
  });

  it("keeps a draft when using Next without submitting and Previous", async () => {
    const user = userEvent.setup();
    await load();
    await user.type(field(), "First draft");
    await user.click(controls().getByRole("button", { name: "Next without submitting" }));
    expect(screen.getByRole("heading", { name: "Explain concept 2" })).toBeInTheDocument();
    await user.type(field(), "Second draft");
    await user.click(controls().getByRole("button", { name: "Previous" }));
    expect(field()).toHaveValue("First draft");
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "0 of 2 questions submitted");
  });

  it("keeps drafts through numbered navigation and independent flag changes", async () => {
    const user = userEvent.setup();
    await load();
    await user.type(field(), "Flagged draft");
    await user.click(screen.getByRole("button", { name: "Flag for Review" }));
    await screen.findByRole("button", { name: "Flagged for Review" });
    await user.click(navigation().getByRole("button", { name: /^Question 2(?:,|$)/ }));
    await user.click(navigation().getByRole("button", { name: /^Question 1(?:,|$)/ }));
    expect(field()).toHaveValue("Flagged draft");
    expect(screen.getByRole("button", { name: "Flagged for Review" })).toHaveAttribute("aria-pressed", "true");
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("keeps an oversized paste intact and prevents submission until corrected", async () => {
    const user = userEvent.setup();
    await load();
    const text = "😀".repeat(10_001);
    await user.click(field());
    await user.paste(text);
    expect(field()).toHaveValue(text);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("your text has not been cut off");
    expect(controls().getByRole("button", { name: "Submit answer" })).toBeDisabled();
    expect(screen.getByText("Remove 1 character to enable Submit answer.")).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "😀".repeat(10_000) } });
    expect(controls().getByRole("button", { name: "Submit answer" })).toBeEnabled();
    expect(field()).toHaveAttribute("aria-invalid", "false");
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("submits exact text, stays on the question, and moves focus to Next", async () => {
    const user = userEvent.setup();
    await load();
    const text = "  One\n\n\tTwo 😀  ";
    await user.click(field());
    await user.paste(text);
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    await screen.findByText("Answer submitted. Pending feedback.");
    expect(submitAnswer).toHaveBeenCalledExactlyOnceWith("attempt", "essay-1", { selected_option_ids: null, text_response: text }, "token");
    expect(field()).toHaveAttribute("readonly");
    expect(field()).not.toBeDisabled();
    expect(field()).toHaveValue(text);
    expect(screen.getByRole("heading", { name: "Explain concept 1" })).toBeInTheDocument();
    expect(controls().getByRole("button", { name: "Next Question" })).toHaveFocus();
    expect(screen.queryByText("Incorrect answer.", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Correct answer.", { exact: true })).not.toBeInTheDocument();
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("prevents a rapid double-click during a slow save", async () => {
    let resolve!: (feedback: QuestionFeedback) => void;
    vi.mocked(submitAnswer).mockReturnValue(new Promise((yes) => { resolve = yes; }));
    const user = userEvent.setup();
    await load();
    await user.type(field(), "Response");
    await user.dblClick(controls().getByRole("button", { name: "Submit answer" }));
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(field()).toHaveAttribute("readonly");
    expect(field()).toHaveAttribute("aria-busy", "true");
    expect(controls().getByRole("button", { name: "Submitting..." })).toBeDisabled();
    expect(controls().getByRole("button", { name: "Next without submitting" })).toBeDisabled();
    await act(async () => resolve(confirmation()));
  });

  it("keeps the failed draft editable and retries without changing its text", async () => {
    vi.mocked(submitAnswer).mockRejectedValueOnce(new ApiError(503, "Save unavailable"));
    const user = userEvent.setup();
    await load();
    await user.type(field(), "Keep this draft");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your response is still here");
    expect(field()).toHaveValue("Keep this draft");
    expect(field()).not.toHaveAttribute("readonly");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    await screen.findByText("Answer submitted. Pending feedback.");
    expect(submitAnswer).toHaveBeenCalledTimes(2);
  });

  it("restores an already submitted essay as selectable read-only text", async () => {
    const data = attempt();
    data.questions[0].response = { question_version_id: "essay-1", selected_option_ids: null,
      text_response: "  Stored\n\nresponse  ", is_submitted: true, answered_at: "2026-11-27T00:00:00Z", is_correct: null };
    await load(data);
    expect(field()).toHaveAttribute("readonly");
    expect(field()).not.toBeDisabled();
    expect(field()).toHaveValue("  Stored\n\nresponse  ");
    expect(screen.getByText("Answer submitted. Pending feedback.")).toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("shows only one reachable Finish action after the final essay is submitted", async () => {
    const user = userEvent.setup();
    await load(attempt(1));
    await user.type(field(), "Complete response");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    const finish = await screen.findByRole("button", { name: "Finish Exam" });
    expect(finish).toBe(controls().getByRole("button", { name: "Finish Exam" }));
    expect(finish).toHaveFocus();
    expect(screen.getAllByRole("button", { name: "Finish Exam" })).toHaveLength(1);
    expect(submitExam).not.toHaveBeenCalled();
    vi.mocked(submitExam).mockResolvedValue({ attempt_id: "attempt", status: "submitted", question_count: 1,
      answered_count: 1, unanswered_count: 0, submitted_at: "2026-11-27T00:00:00Z", results_url: "/ignored" });
    await user.click(finish);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/exams/attempt/results"));
  });

  it("does not enable Finish while an earlier draft remains unsubmitted", async () => {
    const user = userEvent.setup();
    const data = attempt();
    data.current_position = 2;
    await load(data);
    await user.type(field(), "Second response");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    const review = await screen.findByRole("button", { name: "Review unanswered questions" });
    expect(screen.queryByRole("button", { name: "Finish Exam" })).not.toBeInTheDocument();
    await user.click(review);
    expect(screen.getByRole("heading", { name: "Explain concept 1" })).toBeInTheDocument();
    expect(submitExam).not.toHaveBeenCalled();
  });

  it("can open and close the mobile question navigator with the keyboard", async () => {
    const user = userEvent.setup();
    await load();
    const trigger = screen.getByRole("button", { name: /^Question navigation/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Mobile question navigation" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("displays a cross-tab conflict without discarding the unsent essay", async () => {
    const user = userEvent.setup();
    await load();
    const server = attempt();
    server.questions[0].response = { question_version_id: "essay-1", selected_option_ids: null,
      text_response: "Previously saved", is_submitted: true, answered_at: "2026-11-27T00:00:00Z" };
    vi.mocked(getExam).mockResolvedValueOnce(server);
    vi.mocked(submitAnswer).mockRejectedValueOnce(new ApiError(409, "Already submitted"));
    await user.type(field(), "Local unsent draft");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    const summary = await screen.findByText("Your unsent draft (not submitted)");
    expect(field()).toHaveValue("Previously saved");
    expect(field()).toHaveAttribute("readonly");
    await user.click(summary);
    expect(screen.getByText("Local unsent draft")).toBeVisible();
  });

  it("retains existing short-answer controls in a mixed exam", async () => {
    const user = userEvent.setup();
    const data = attempt();
    data.questions[1].question_type = "short_answer";
    await load(data);
    await user.click(controls().getByRole("button", { name: "Next without submitting" }));
    const short = screen.getByRole("textbox", { name: "Your answer" });
    expect(screen.queryByRole("textbox", { name: "Your essay response" })).not.toBeInTheDocument();
    await user.type(short, "  Short response  ");
    await user.click(controls().getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith("attempt", "essay-2", { selected_option_ids: null, text_response: "Short response" }, "token"));
  });

  it("directs completed attempts to results instead of inventing a pending grade", async () => {
    const user = userEvent.setup();
    const data = attempt(1);
    data.status = "submitted";
    data.questions[0].response = { question_version_id: "essay-1", selected_option_ids: null,
      text_response: "Completed response", is_submitted: true, answered_at: "2026-11-27T00:00:00Z", is_correct: true };
    await load(data);
    expect(field()).toHaveAttribute("readonly");
    expect(screen.getByText("Answer submitted. View results for feedback.")).toBeInTheDocument();
    expect(screen.queryByText("Answer submitted. Pending feedback.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish Exam" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View results" }));
    expect(replace).toHaveBeenCalledWith("/exams/attempt/results");
  });

});
