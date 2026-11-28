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
  expectedRevision?: number,
): Promise<FinalExamSubmissionResponse> {
  return apiRequest<FinalExamSubmissionResponse>(
    `/exams/${encodeURIComponent(attemptId)}/submit`,
    token,
    {
      method: "POST",
      ...(expectedRevision === undefined ? {} : { body: JSON.stringify({ expected_revision: expectedRevision }) }),
    },
  );
}
