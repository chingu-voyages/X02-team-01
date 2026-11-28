import { describe, expect, it } from "vitest";
import { deriveQuestionStates } from "./question-states";

const questions = [
  { id: "essay", question_type: "essay" as const, flagged_for_review: true },
  { id: "short", question_type: "short_answer" as const },
  { id: "choice", question_type: "multiple_choice" as const },
];
function states(text = "", submittedMap: Record<string, boolean> = {}) {
  return deriveQuestionStates({ questions, currentQuestionIndex: 0, submittedMap,
    textAnswersMap: { essay: text, short: "Short draft" }, selectedValuesMap: { choice: ["a"] } });
}

describe("JHEP-120 essay navigation states", () => {
  it("distinguishes a blank essay from written drafts", () => {
    expect(states(" \n").questionStates.map((q) => q.responseState)).toEqual(["unanswered", "unsubmitted", "unsubmitted"]);
  });
  it("marks an essay draft without counting it as submitted", () => {
    const result = states("My draft");
    expect(result.questionStates[0]).toEqual({ questionId: "essay", responseState: "unsubmitted", isFlagged: true, isCurrent: true });
    expect(result.submittedCount).toBe(0);
    expect(result.allQuestionsSubmitted).toBe(false);
  });
  it("retains an over-limit draft in the navigation state", () => {
    expect(states("a".repeat(10_001)).questionStates[0].responseState).toBe("unsubmitted");
  });
  it("counts only confirmed answers and preserves independent flags", () => {
    const result = states("Stored answer", { essay: true, short: true, choice: true });
    expect(result.submittedCount).toBe(3);
    expect(result.firstUnsubmittedIndex).toBe(-1);
    expect(result.allQuestionsSubmitted).toBe(true);
    expect(result.questionStates[0].isFlagged).toBe(true);
  });
  it("does not treat a stray option selection as essay content", () => {
    const result = deriveQuestionStates({ questions: [questions[0]], currentQuestionIndex: 0,
      submittedMap: {}, textAnswersMap: {}, selectedValuesMap: { essay: ["wrong-channel"] } });
    expect(result.questionStates[0].responseState).toBe("unanswered");
  });
});
