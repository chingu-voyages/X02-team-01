import { describe, expect, it } from "vitest";
import { deriveQuestionStates } from "./question-states";

describe("JHEP-106 question state indicators", () => {
  const questions = [
    {
      id: "q1",
      question_type: "multiple_choice",
      flagged_for_review: true,
    },
    {
      id: "q2",
      question_type: "multiple_choice",
      flagged_for_review: true,
    },
    {
      id: "q3",
      question_type: "short_answer",
      flagged_for_review: true,
    },
    {
      id: "q4",
      question_type: "short_answer",
    },
  ] as const;

  const input = {
    questions,
    currentQuestionIndex: 0,
    submittedMap: {},
    selectedValuesMap: {},
    textAnswersMap: {},
  };

  it("identifies unanswered questions", () => {
    const result = deriveQuestionStates(input);

    expect(
      result.questionStates.map((q) => q.responseState),
    ).toEqual([
      "unanswered",
      "unanswered",
      "unanswered",
      "unanswered",
    ]);

    expect(result.submittedCount).toBe(0);
    expect(result.remainingCount).toBe(4);
    expect(result.allQuestionsSubmitted).toBe(false);
    expect(result.firstUnsubmittedIndex).toBe(0);
  });

  it("distinguishes selected answers from submitted answers", () => {
    const result = deriveQuestionStates({
      ...input,
      selectedValuesMap: {
        q1: ["option-a"],
        q2: ["option-a", "option-b"],
      },
      textAnswersMap: {
        q3: "Draft answer",
      },
    });

    expect(
      result.questionStates.map((q) => q.responseState),
    ).toEqual([
      "unsubmitted",
      "unsubmitted",
      "unsubmitted",
      "unanswered",
    ]);

    expect(result.submittedCount).toBe(0);
    expect(result.remainingCount).toBe(4);
  });

  it("prioritizes confirmed submission over draft state", () => {
    const result = deriveQuestionStates({
      ...input,
      submittedMap: {
        q1: true,
        q3: true,
      },
      selectedValuesMap: {
        q1: ["option-a"],
      },
      textAnswersMap: {
        q3: "Submitted text answer",
      },
    });

    expect(result.questionStates[0].responseState)
      .toBe("submitted");

    expect(result.questionStates[2].responseState)
      .toBe("submitted");

    expect(result.submittedCount).toBe(2);
    expect(result.remainingCount).toBe(2);
    expect(result.firstUnsubmittedIndex).toBe(1);
  });

  it("keeps flags independent of response states", () => {
    const result = deriveQuestionStates({
      ...input,
      currentQuestionIndex: 2,
      submittedMap: {
        q3: true,
      },
      selectedValuesMap: {
        q2: ["option-a"],
      },
    });

    expect(result.questionStates[0]).toEqual({
      questionId: "q1",
      responseState: "unanswered",
      isFlagged: true,
      isCurrent: false,
    });

    expect(result.questionStates[1]).toEqual({
      questionId: "q2",
      responseState: "unsubmitted",
      isFlagged: true,
      isCurrent: false,
    });

    expect(result.questionStates[2]).toEqual({
      questionId: "q3",
      responseState: "submitted",
      isFlagged: true,
      isCurrent: true,
    });

    expect(result.questionStates[3].isFlagged).toBe(false);
    expect(result.submittedCount).toBe(1);
    expect(result.remainingCount).toBe(3);
  });

  it("treats empty selections and whitespace as unanswered", () => {
    const result = deriveQuestionStates({
      ...input,
      selectedValuesMap: {
        q1: [],
        q2: [],
      },
      textAnswersMap: {
        q3: "   ",
        q4: "\n\t",
      },
    });

    expect(
      result.questionStates.every(
        (q) => q.responseState === "unanswered",
      ),
    ).toBe(true);
  });

  it("preserves response states when navigating", () => {
    const data = {
      ...input,
      submittedMap: { q1: true },
      selectedValuesMap: { q2: ["option-a"] },
      textAnswersMap: { q3: "Draft" },
    };

    const before = deriveQuestionStates(data);

    const after = deriveQuestionStates({
      ...data,
      currentQuestionIndex: 3,
    });

    expect(after.questionStates[0].isCurrent).toBe(false);
    expect(after.questionStates[3].isCurrent).toBe(true);

    expect(
      after.questionStates.map((q) => q.responseState),
    ).toEqual(
      before.questionStates.map((q) => q.responseState),
    );

    expect(after.submittedCount).toBe(before.submittedCount);
  });

  it("ignores responses outside the active attempt", () => {
    const result = deriveQuestionStates({
      ...input,
      submittedMap: {
        q1: true,
        "other-attempt-question": true,
      },
    });

    expect(result.totalQuestions).toBe(4);
    expect(result.submittedCount).toBe(1);
    expect(result.remainingCount).toBe(3);
  });

  it("recognizes a fully submitted attempt", () => {
    const result = deriveQuestionStates({
      ...input,
      submittedMap: {
        q1: true,
        q2: true,
        q3: true,
        q4: true,
      },
    });

    expect(result.submittedCount).toBe(4);
    expect(result.remainingCount).toBe(0);
    expect(result.allQuestionsSubmitted).toBe(true);
    expect(result.firstUnsubmittedIndex).toBe(-1);
  });

  it("handles an empty attempt safely", () => {
    const result = deriveQuestionStates({
      ...input,
      questions: [],
    });

    expect(result.questionStates).toEqual([]);
    expect(result.totalQuestions).toBe(0);
    expect(result.submittedCount).toBe(0);
    expect(result.remainingCount).toBe(0);
    expect(result.allQuestionsSubmitted).toBe(false);
    expect(result.firstUnsubmittedIndex).toBe(-1);
  });
});