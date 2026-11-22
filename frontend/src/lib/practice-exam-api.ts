import { apiRequest } from "@/lib/api-client";

import type { ExamCreatedResponse } from "@/types/exam-api.types";
import type {
  PublishedPracticeExam,
  PublishedPracticeExamListResponse,
} from "@/types/practice-exam-api.types";

/** Only practice exams published by an admin and currently startable. */
export async function getPublishedPracticeExams(
  token: string,
): Promise<PublishedPracticeExam[]> {
  const result = await apiRequest<PublishedPracticeExamListResponse>(
    "/exams/catalog",
    token,
    { method: "GET", cache: "no-store" },
  );
  return result.exams;
}

/** Never accept an adjustable count from the learner. */
export async function startPublishedPracticeExam(
  token: string,
  exam: PublishedPracticeExam,
): Promise<ExamCreatedResponse> {
  return apiRequest<ExamCreatedResponse>("/exams", token, {
    method: "POST",
    body: JSON.stringify({
      practice_exam_id: exam.id,
      certification_id: exam.certification_id,
      category_id: exam.category_id,
      question_count: exam.question_count,
    }),
  });
}
