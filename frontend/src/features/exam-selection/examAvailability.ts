import { ApiError } from "@/lib/api-client";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

export interface ExamStartIssue {
  message: string;
  requiresReload: boolean;
}

export function isValidExamCount(count: unknown): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 100;
}

/** Defensive UI guard; the server still owns publication and eligibility. */
export function getExamAvailabilityIssue(exam: PublishedPracticeExam): string | null {
  if (!isValidExamCount(exam.question_count)) {
    return "The exam length is not configured correctly. Reload exams to check availability.";
  }
  if (!Number.isSafeInteger(exam.available_question_count) || exam.available_question_count < 0) {
    return "Exam availability could not be verified. Reload exams and try again.";
  }
  if (exam.available_question_count < exam.question_count) {
    return "There are not enough approved questions to start this exam right now. Reload exams to check availability.";
  }
  return null;
}

export function getExamStartIssue(error: unknown): ExamStartIssue {
  if (error instanceof ApiError) {
    const detail = error.detail;
    const code = detail !== null && typeof detail === "object" && "code" in detail
      ? detail.code
      : undefined;

    if (error.status === 409 && code === "PRACTICE_EXAM_COUNT_MISMATCH") {
      return {
        message: "The exam length has changed since you opened this page. Reload exams to see the new question count before starting.",
        requiresReload: true,
      };
    }
    if (error.status === 409 && code === "INSUFFICIENT_QUESTIONS") {
      return {
        message: "There are no longer enough approved questions to start this exam. Reload exams to check availability.",
        requiresReload: true,
      };
    }
    if (error.status === 409 || error.status === 404 || error.status === 422) {
      return {
        message: "This practice exam is no longer available as shown. Reload exams to check the latest configuration.",
        requiresReload: true,
      };
    }
    if (error.status === 403) {
      return {
        message: "You do not have permission to start this exam. If this is unexpected, contact an administrator.",
        requiresReload: false,
      };
    }
  }
  return {
    message: "We could not start this exam. Check your connection and try again. If an attempt was created, you can continue it on your next try.",
    requiresReload: false,
  };
}
