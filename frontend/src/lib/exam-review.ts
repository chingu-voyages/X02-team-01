import { apiRequest } from "@/lib/api-client";
import {
  reviewStatuses,
  type CompletedExamReview,
  type ReviewQuestion,
  type ReviewStatus,
} from "@/types/exam-review.types";

export const reviewUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidReview(): never {
  throw new Error("Unexpected completed exam review received.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && reviewStatuses.some((item) => item === value);
}

export async function getCompletedExamReview(
  attemptId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<CompletedExamReview> {
  const payload = await apiRequest<unknown>(
    `/exams/${encodeURIComponent(attemptId)}/review`,
    accessToken,
    { method: "GET", signal },
  );

  // Fail closed rather than displaying a foreign, unfinished or malformed list.
  if (
    !isRecord(payload) ||
    typeof payload.attempt_id !== "string" ||
    payload.attempt_id.toLowerCase() !== attemptId.toLowerCase() ||
    payload.status !== "submitted" ||
    typeof payload.question_count !== "number" ||
    !Number.isSafeInteger(payload.question_count) ||
    payload.question_count < 0 ||
    !Array.isArray(payload.questions)
  ) {
    return invalidReview();
  }

  const questions: ReviewQuestion[] = [];
  const seen = new Set<string>();
  const positions = new Set<number>();
  for (const question of payload.questions) {
    if (
      !isRecord(question) ||
      typeof question.question_version_id !== "string" ||
      !reviewUuidPattern.test(question.question_version_id) ||
      typeof question.position !== "number" ||
      !Number.isSafeInteger(question.position) ||
      question.position < 1 ||
      question.position > payload.question_count ||
      positions.has(question.position) ||
      seen.has(question.question_version_id.toLowerCase()) ||
      typeof question.preview !== "string" ||
      !question.preview.trim() ||
      !isReviewStatus(question.status)
    ) {
      return invalidReview();
    }
    seen.add(question.question_version_id.toLowerCase());
    positions.add(question.position);
    // Select only list fields, even if a future server adds extra content.
    questions.push({
      question_version_id: question.question_version_id,
      position: question.position,
      preview: question.preview,
      status: question.status,
    });
  }

  // An explicitly empty historical list has its own unavailable UI. Never
  // silently present a nonempty but incomplete list as the complete attempt.
  if (questions.length > 0 && questions.length !== payload.question_count) {
    return invalidReview();
  }

  return {
    attempt_id: payload.attempt_id,
    status: "submitted",
    question_count: payload.question_count,
    questions: questions.sort((a, b) => a.position - b.position),
  };
}
