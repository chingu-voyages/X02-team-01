import { apiRequest } from "@/lib/api-client";

import type {
  AnswerSubmission,
  ExamAttempt,
  QuestionFeedback,
} from "@/types/exam-api.types";

/** Load an existing attempt with its pinned questions and saved answers. */
export async function getExam(
  attemptId: string,
  token: string,
): Promise<ExamAttempt> {
  return apiRequest<ExamAttempt>(
    `/exams/${encodeURIComponent(attemptId)}`,
    token,
    {
      method: "GET",
      cache: "no-store",
    },
  );
}
/**
 * Submit (and thereby lock) one question's answer.
 *
 * The backend alone grades: send the chosen options or the short-answer
 * text, and render only what the response returns. In deferred feedback
 * mode the response omits `is_correct`/`correct_option_ids`/`explanation`
 * — their absence is not a wrong answer.
 */
export async function submitAnswer(
  attemptId: string,
  questionVersionId: string,
  answer: AnswerSubmission,
  token: string,
): Promise<QuestionFeedback> {
  return apiRequest<QuestionFeedback>(
    `/exams/${encodeURIComponent(attemptId)}/responses/${encodeURIComponent(questionVersionId)}/submit`,
    token,
    {
      method: "POST",
      body: JSON.stringify(answer),
    },
  );
}
