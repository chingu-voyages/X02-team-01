import { apiRequest } from "@/lib/api-client";

export interface UnfinishedExam {
  attempt_id: string;
  practice_exam_id: string | null;
  certification_name: string;
  category_name: string | null;
  name: string | null;
  question_count: number;
  submitted_count: number;
  current_position: number;
  started_at: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUnfinishedExam(value: unknown): value is UnfinishedExam {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<UnfinishedExam>;
  return typeof item.attempt_id === "string" && uuidPattern.test(item.attempt_id) &&
    (item.practice_exam_id === null || (typeof item.practice_exam_id === "string" && uuidPattern.test(item.practice_exam_id))) &&
    typeof item.certification_name === "string" && Boolean(item.certification_name.trim()) &&
    (item.category_name === null || typeof item.category_name === "string") &&
    (item.name === null || typeof item.name === "string") &&
    typeof item.question_count === "number" && Number.isSafeInteger(item.question_count) && item.question_count > 0 &&
    typeof item.submitted_count === "number" && Number.isSafeInteger(item.submitted_count) && item.submitted_count >= 0 && item.submitted_count <= item.question_count &&
    typeof item.current_position === "number" && Number.isSafeInteger(item.current_position) && item.current_position >= 1 && item.current_position <= item.question_count &&
    typeof item.started_at === "string" && Number.isFinite(Date.parse(item.started_at));
}

/** Recovery discovery is independent of the catalog of new exams. */
export async function getUnfinishedExamAttempts(token: string): Promise<UnfinishedExam[]> {
  const result = await apiRequest<unknown>("/exams/unfinished", token, { method: "GET", cache: "no-store" });
  if (!result || typeof result !== "object" || !("attempts" in result) ||
      !Array.isArray(result.attempts) || !result.attempts.every(isUnfinishedExam)) {
    throw new Error("Unable to read unfinished exams.");
  }
  const attempts: UnfinishedExam[] = result.attempts;
  if (new Set(attempts.map((item) => item.attempt_id)).size !== attempts.length) {
    throw new Error("Unable to read unfinished exams.");
  }
  return attempts;
}
