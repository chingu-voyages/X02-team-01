import { describe, expect, it } from "vitest";
import {
  answerValidationMessage, buildAnswerSubmission, isMatchingSubmission,
  isWrittenQuestion, submissionFeedback,
} from "./exam-response";
import type { QuestionFeedback } from "@/types/exam-api.types";

const confirmed: QuestionFeedback = {
  attempt_id: "attempt-1", question_version_id: "version-1",
  is_submitted: true, feedback_released: false,
};

describe("JHEP-120 exam response contract", () => {
  it.each(["essay", "short_answer"] as const)("recognizes %s as written text", (type) => {
    expect(isWrittenQuestion(type)).toBe(true);
  });
  it("does not classify multiple choice as written text", () => {
    expect(isWrittenQuestion("multiple_choice")).toBe(false);
  });
  it.each(["", " ", "\n\t", "\u00a0"])("blocks a blank essay: %j", (text) => {
    expect(answerValidationMessage("essay", text, [])).toMatch(/Enter a response/);
  });
  it.each(["x".repeat(10_000), "😀".repeat(10_000)])("accepts exactly the code-point limit", (text) => {
    expect(answerValidationMessage("essay", text, [])).toBe("");
    expect(buildAnswerSubmission("essay", text, []).text_response).toBe(text);
  });
  it("blocks one excess character and does not truncate it", () => {
    const text = "😀".repeat(10_001);
    expect(answerValidationMessage("essay", text, [])).toBe("Remove 1 character to enable Submit answer.");
    expect(buildAnswerSubmission("essay", text, []).text_response).toBe(text);
  });
  it("reports the full excess for a large paste", () => {
    expect(answerValidationMessage("essay", "a".repeat(12_000), [])).toMatch(/2,000 characters/);
  });
  it("preserves essay whitespace, line breaks, Unicode and literal markup", () => {
    const text = '  A\n\n\tB 😀 e\u0301 <script>literal</script>  ';
    expect(buildAnswerSubmission("essay", text, ["ignored-option"])).toEqual({ selected_option_ids: null, text_response: text });
  });
  it("preserves existing short-answer trimming", () => {
    expect(buildAnswerSubmission("short_answer", "  Answer  ", [])).toEqual({ selected_option_ids: null, text_response: "Answer" });
    expect(answerValidationMessage("short_answer", " ", [])).toMatch(/Enter an answer/);
  });
  it("keeps multiple-choice payloads separate from essay text", () => {
    const options = ["a", "b"];
    const answer = buildAnswerSubmission("multiple_choice", "ignored text", options);
    expect(answer).toEqual({ selected_option_ids: ["a", "b"], text_response: null });
    expect(answer.selected_option_ids).not.toBe(options);
    expect(answerValidationMessage("multiple_choice", "ignored text", [])).toMatch(/Choose an answer/);
    expect(answerValidationMessage("multiple_choice", "", options)).toBe("");
  });
  it("accepts only the requested question and attempt", () => {
    expect(isMatchingSubmission(confirmed, "attempt-1", "version-1")).toBe(true);
    expect(isMatchingSubmission(confirmed, "attempt-2", "version-1")).toBe(false);
    expect(isMatchingSubmission(confirmed, "attempt-1", "version-2")).toBe(false);
  });
  it("supports older fixtures without attempt_id", () => {
    const { attempt_id: _attemptId, ...legacy } = confirmed;
    expect(isMatchingSubmission(legacy, "attempt-1", "version-1")).toBe(true);
  });
  it("rejects an unconfirmed answer", () => {
    expect(isMatchingSubmission({ ...confirmed, is_submitted: false } as unknown as QuestionFeedback, "attempt-1", "version-1")).toBe(false);
  });
  it("never treats an essay save as an automatic grade", () => {
    expect(submissionFeedback("essay", { ...confirmed, feedback_released: true, is_correct: false, correct_option_ids: ["a"], explanation: "Not essay feedback" })).toEqual({
      feedback_released: false, is_correct: null, correct_option_ids: [], explanation: null,
    });
  });
  it("withholds deferred multiple-choice correctness", () => {
    expect(submissionFeedback("multiple_choice", { ...confirmed, is_correct: true, correct_option_ids: ["a"] }).is_correct).toBeNull();
  });
  it("retains released multiple-choice correctness", () => {
    expect(submissionFeedback("multiple_choice", { ...confirmed, feedback_released: true, is_correct: false, correct_option_ids: ["b"], explanation: "Explanation" })).toEqual({
      feedback_released: true, is_correct: false, correct_option_ids: ["b"], explanation: "Explanation",
    });
  });
  it("handles API nulls without inventing a verdict", () => {
    expect(submissionFeedback("short_answer", { ...confirmed, feedback_released: true, is_correct: null, correct_option_ids: null, explanation: null })).toEqual({
      feedback_released: true, is_correct: null, correct_option_ids: [], explanation: null,
    });
  });
});
