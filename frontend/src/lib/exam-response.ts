import { validateEssayResponse } from "@/lib/essay-response";
import type {
  AnswerSubmission,
  ExamQuestion,
  FeedbackEntry,
  QuestionFeedback,
} from "@/types/exam-api.types";

/** One definition shared by submission and the question navigator. */
export function isWrittenQuestion(type: ExamQuestion["question_type"]): boolean {
  return type === "short_answer" || type === "essay";
}

export function answerValidationMessage(
  type: ExamQuestion["question_type"],
  text: string,
  selectedOptionIds: readonly string[],
): string {
  if (type === "essay") {
    const validation = validateEssayResponse(text);
    if (validation.isOverLimit) {
      const excess = -validation.remainingCharacters;
      return `Remove ${excess.toLocaleString("en-US")} character${excess === 1 ? "" : "s"} to enable Submit answer.`;
    }
    if (validation.isBlank) return "Enter a response to enable Submit answer.";
    return "";
  }
  if (type === "short_answer") {
    return text.trim() ? "" : "Enter an answer before submitting.";
  }
  return selectedOptionIds.length ? "" : "Choose an answer before submitting.";
}

/** Essay text is exact: never trim, truncate or normalize it before saving. */
export function buildAnswerSubmission(
  type: ExamQuestion["question_type"],
  text: string,
  selectedOptionIds: readonly string[],
): AnswerSubmission {
  if (type === "essay") {
    return { selected_option_ids: null, text_response: text };
  }
  if (type === "short_answer") {
    // Preserve the existing short-answer contract.
    return { selected_option_ids: null, text_response: text.trim() || null };
  }
  return { selected_option_ids: [...selectedOptionIds], text_response: null };
}

/** A success belonging to a different question must never lock this draft. */
export function isMatchingSubmission(
  feedback: QuestionFeedback,
  attemptId: string,
  questionId: string,
): boolean {
  return Boolean(
    feedback &&
      feedback.is_submitted === true &&
      feedback.question_version_id === questionId &&
      // Older fixtures omit this; the current API includes it.
      (feedback.attempt_id === undefined || feedback.attempt_id === attemptId),
  );
}

export function submissionFeedback(
  type: ExamQuestion["question_type"],
  feedback?: QuestionFeedback,
): FeedbackEntry {
  // An essay save is not a grade, even in an immediate-feedback exam.
  const released = type !== "essay" && feedback?.feedback_released === true;
  return {
    feedback_released: released,
    is_correct:
      released && typeof feedback?.is_correct === "boolean"
        ? feedback.is_correct
        : null,
    correct_option_ids: released ? (feedback?.correct_option_ids ?? []) : [],
    explanation: released ? (feedback?.explanation ?? null) : null,
  };
}
