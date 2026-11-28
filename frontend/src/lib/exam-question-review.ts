import { apiRequest } from "@/lib/api-client";
import { reviewUuidPattern } from "@/lib/exam-review";
import type { ExamImage, ExamOption } from "@/types/exam-api.types";
import { gradeOutcomes, type CompletedQuestionReview } from "@/types/exam-question-review.types";
import { reviewStatuses, type ReviewQuestion } from "@/types/exam-review.types";

export function questionReviewHref(attemptId: string, versionId: string) {
  return `/exams/${encodeURIComponent(attemptId)}/review/questions/${encodeURIComponent(versionId)}`;
}

function invalid(): never {
  throw new Error("Unexpected completed question review received.");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && reviewUuidPattern.test(value);
}

function integer(value: unknown, min = 1): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function sameId(value: unknown, expected: string): value is string {
  return uuid(value) && value.toLowerCase() === expected.toLowerCase();
}

function ordered<T extends { id: string; position: number }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id.toLowerCase())).size !== items.length ||
      new Set(items.map((item) => item.position)).size !== items.length) invalid();
  return items.sort((a, b) => a.position - b.position);
}

function optionIds(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return invalid();
  const ids: string[] = [];
  for (const id of value) {
    if (!uuid(id) || !allowed.has(id.toLowerCase())) return invalid();
    ids.push(id.toLowerCase());
  }
  if (new Set(ids).size !== ids.length) return invalid();
  return ids;
}

function safeMediaUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

export function parseCompletedQuestionReview(payload: unknown, attemptId: string, versionId: string): CompletedQuestionReview {
  if (!record(payload) || !sameId(payload.attempt_id, attemptId) ||
      !sameId(payload.question_version_id, versionId) || payload.attempt_status !== "submitted" ||
      !integer(payload.question_count) || !integer(payload.position) || payload.position > payload.question_count ||
      typeof payload.question_text !== "string" || !payload.question_text.trim() ||
      (payload.question_type !== "multiple_choice" && payload.question_type !== "short_answer") ||
      typeof payload.allows_multiple_answers !== "boolean" ||
      (payload.question_type === "short_answer" && payload.allows_multiple_answers) ||
      !reviewStatuses.some((status) => status === payload.question_status) ||
      !Array.isArray(payload.options) || !Array.isArray(payload.images) || !nullableText(payload.explanation)) return invalid();

  const options = ordered(payload.options.map((item: unknown): ExamOption => {
    if (!record(item) || !uuid(item.id) || !integer(item.position) || typeof item.option_text !== "string" || !item.option_text.trim()) return invalid();
    return { id: item.id.toLowerCase(), position: item.position, option_text: item.option_text };
  }));
  const images = ordered(payload.images.map((item: unknown): ExamImage => {
    if (!record(item) || !uuid(item.id) || !integer(item.position) || typeof item.alt_text !== "string" ||
        !item.alt_text.trim() || !safeMediaUrl(item.url) ||
        (item.media_type !== "image/png" && item.media_type !== "image/jpeg" && item.media_type !== "image/webp")) return invalid();
    return { id: item.id, position: item.position, alt_text: item.alt_text, media_type: item.media_type, url: item.url };
  }));
  const allowed = new Set(options.map((option) => option.id));
  const correctIds = payload.correct_option_ids === null ? null : optionIds(payload.correct_option_ids, allowed);
  const written = payload.question_type === "short_answer";
  if (written ? options.length !== 0 || correctIds !== null : options.length === 0 || correctIds?.length === 0) return invalid();

  let response: CompletedQuestionReview["submitted_response"] = null;
  if (payload.submitted_response !== null) {
    const saved = payload.submitted_response;
    if (!record(saved) || saved.is_submitted !== true || !nullableText(saved.text_response) ||
        typeof saved.answered_at !== "string" || !nullableText(saved.question_submitted_at)) return invalid();
    const selected = optionIds(saved.selected_option_ids, allowed);
    if (written ? selected.length > 0 || !saved.text_response?.trim() : selected.length === 0 || saved.text_response !== null) return invalid();
    response = { selected_option_ids: selected, text_response: saved.text_response, is_submitted: true,
      answered_at: saved.answered_at, question_submitted_at: saved.question_submitted_at };
  }
  let grading: CompletedQuestionReview["grading"] = null;
  if (payload.grading !== null) {
    const grade = payload.grading;
    if (!record(grade) || !gradeOutcomes.some((outcome) => outcome === grade.outcome) ||
        !integer(grade.points_earned, 0) || (grade.max_points !== null && !integer(grade.max_points, 0)) ||
        !nullableText(grade.feedback)) return invalid();
    grading = { outcome: grade.outcome as NonNullable<CompletedQuestionReview["grading"]>["outcome"],
      points_earned: grade.points_earned, max_points: grade.max_points, feedback: grade.feedback };
  }
  return {
    attempt_id: payload.attempt_id, attempt_status: "submitted", question_count: payload.question_count,
    question_version_id: payload.question_version_id, position: payload.position, question_text: payload.question_text,
    question_type: payload.question_type, allows_multiple_answers: payload.allows_multiple_answers,
    question_status: payload.question_status as CompletedQuestionReview["question_status"], options, images,
    submitted_response: response, correct_option_ids: correctIds, explanation: payload.explanation, grading,
  };
}

export async function getCompletedQuestionReview(attemptId: string, versionId: string, token: string, signal?: AbortSignal) {
  const payload = await apiRequest<unknown>(questionReviewHref(attemptId, versionId), token, { method: "GET", signal });
  return parseCompletedQuestionReview(payload, attemptId, versionId);
}

export function reviewNeighbors(detail: CompletedQuestionReview, questions: ReviewQuestion[]): { previous?: ReviewQuestion; next?: ReviewQuestion } {
  const index = questions.findIndex((item) => sameId(item.question_version_id, detail.question_version_id));
  if (index < 0 || questions.length !== detail.question_count || questions[index].position !== detail.position) return invalid();
  return { previous: questions[index - 1], next: questions[index + 1] };
}
