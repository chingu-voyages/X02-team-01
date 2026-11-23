import { apiRequest } from "@/lib/api-client";

import type {
  AdminPracticeExam,
  AdminPracticeExamCreateRequest,
  AdminPracticeExamListResponse,
  PracticeExamNotReadyDetail,
} from "@/types/admin-practice-exam-api.types";

/** All statuses; backend requires a current Administrator account. */
export async function getAdminPracticeExams(
  token: string,
): Promise<AdminPracticeExam[]> {
  const result = await apiRequest<AdminPracticeExamListResponse>(
    "/admin/practice-exams",
    token,
    { method: "GET" },
  );
  return result.items;
}

/** Fetch fresh readiness, e.g., after questions have been published or retired. */
export function getAdminPracticeExam(
  token: string,
  examId: string,
): Promise<AdminPracticeExam> {
  return apiRequest<AdminPracticeExam>(
    `/admin/practice-exams/${encodeURIComponent(examId)}`,
    token,
    { method: "GET" },
  );
}

/** Create a draft. Never try to publish implicitly on creation. */
export function createAdminPracticeExam(
  token: string,
  payload: AdminPracticeExamCreateRequest,
): Promise<AdminPracticeExam> {
  return apiRequest<AdminPracticeExam>(
    "/admin/practice-exams",
    token,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/** Idempotent publish/unpublish endpoint; server owns final validation. */
export function setAdminPracticeExamPublication(
  token: string,
  examId: string,
  isPublished: boolean,
): Promise<AdminPracticeExam> {
  return apiRequest<AdminPracticeExam>(
    `/admin/practice-exams/${encodeURIComponent(examId)}/publication`,
    token,
    { method: "PATCH", body: JSON.stringify({ is_published: isPublished }) },
  );
}

/** Narrow an ApiError.detail to the backend's coded 409 payload. */
export function practiceExamNotReadyDetail(
  detail: unknown,
): PracticeExamNotReadyDetail | null {
  if (
    detail === null ||
    typeof detail !== "object" ||
    !("code" in detail) ||
    detail.code !== "PRACTICE_EXAM_NOT_READY" ||
    !("readiness" in detail)
  ) {
    return null;
  }

  const readiness = detail.readiness;
  if (
    readiness === null ||
    typeof readiness !== "object" ||
    !("ready" in readiness) ||
    typeof readiness.ready !== "boolean" ||
    !("required_question_count" in readiness) ||
    !("eligible_question_count" in readiness) ||
    typeof readiness.eligible_question_count !== "number" ||
    !("issues" in readiness) ||
    !Array.isArray(readiness.issues) ||
    !readiness.issues.every(
      (issue: unknown) =>
        issue !== null &&
        typeof issue === "object" &&
        "code" in issue &&
        typeof issue.code === "string" &&
        "message" in issue &&
        typeof issue.message === "string",
    )
  ) {
    return null;
  }

  return detail as PracticeExamNotReadyDetail;
}
