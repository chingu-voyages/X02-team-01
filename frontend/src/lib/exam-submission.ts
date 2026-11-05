import { apiRequest } from "@/lib/api-client";

import type {
  FinalExamSubmissionResponse,
} from "@/types/exam-submission.types";

/**
 * Finalize an existing practice exam attempt.
 *
 * Requires a valid JWT bearer token.
 * The backend grades previously submitted answers.
 */
export async function submitExam(
  attemptId: string,
  token: string,
): Promise<FinalExamSubmissionResponse> {
  return apiRequest<FinalExamSubmissionResponse>(
    `/exams/${encodeURIComponent(attemptId)}/submit`,
    token,
    {
      method: "POST",
    },
  );
}
