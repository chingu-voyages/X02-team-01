import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExamRecoveryReview from "./ExamRecoveryReview";
import type { ExamQuestionWithResponse } from "@/types/exam-api.types";
import type { RecoveryCopy } from "@/lib/exam-recovery-journal";

afterEach(cleanup);
const question: ExamQuestionWithResponse = {
  id: "q1", position: 1, question_text: "Explain the result", question_type: "short_answer", allows_multiple_answers: false, difficulty: "easy", options: [], images: [],
  response: { question_version_id: "q1", selected_option_ids: null, text_response: "Saved answer", is_submitted: false, answered_at: "2026-11-28T00:00:00Z" },
};
const copy: RecoveryCopy = { key: "copy", raw: "{}", revision: 4, updatedAt: 1795800000000, canRestore: true,
  operations: [{ kind: "draft", questionVersionId: "q1", answer: { selected_option_ids: null, text_response: "Device answer" } }, { kind: "position", currentPosition: 1 }] };
function setup() {
  return { copies: [copy], questions: [question], error: "", onRestore: vi.fn(), onDiscard: vi.fn(), onContinue: vi.fn(), onReload: vi.fn() };
}
describe("Exam recovery review", () => {
  it("focuses the heading and shows device and server answers separately before keyboard restoration", async () => {
    const props = setup();
    const user = userEvent.setup();
    render(<ExamRecoveryReview {...props} />);
    expect(screen.getByRole("heading", { name: "Recover unsaved progress" })).toHaveFocus();
    expect(screen.getByText("Device answer")).toBeVisible();
    expect(screen.getByText("Saved answer")).toBeVisible();
    expect(screen.getByText("Saved device position: question 1")).toBeVisible();
    expect(props.onRestore).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "Restore this copy" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onRestore).toHaveBeenCalledExactlyOnceWith("copy");
    expect(props.onDiscard).not.toHaveBeenCalled();
  });
  it("never offers restoration for a conflicting copy and can continue without discarding it", async () => {
    const props = setup();
    const user = userEvent.setup();
    const locked = { ...question, response: { ...question.response!, is_submitted: true } };
    render(<ExamRecoveryReview {...props} copies={[{ ...copy, canRestore: false }]} questions={[locked]} />);
    expect(screen.getByText("Server saved · Submitted (locked)")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Restore this copy" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with saved progress" }));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(props.onRestore).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation to discard and does not discard on cancellation", async () => {
    const props = setup();
    const user = userEvent.setup();
    render(<ExamRecoveryReview {...props} />);
    const article = within(screen.getByRole("article", { name: "Device copy 1" }));
    await user.click(article.getByRole("button", { name: "Discard device copy" }));
    expect(props.onDiscard).not.toHaveBeenCalled();
    await user.click(article.getByRole("button", { name: "Cancel" }));
    expect(props.onDiscard).not.toHaveBeenCalled();
    await user.click(article.getByRole("button", { name: "Discard device copy" }));
    await user.click(article.getByRole("button", { name: "Confirm discard" }));
    expect(props.onDiscard).toHaveBeenCalledExactlyOnceWith("copy");
  });
  it("provides a reload action if the selected device snapshot changed", async () => {
    const props = setup();
    const user = userEvent.setup();
    render(<ExamRecoveryReview {...props} error="This device copy changed." />);
    expect(screen.getByRole("alert")).toHaveTextContent("This device copy changed.");
    await user.click(screen.getByRole("button", { name: "Reload saved progress" }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
  });
});
