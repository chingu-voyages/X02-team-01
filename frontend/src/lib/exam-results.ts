import { apiRequest } from "@/lib/api-client";

import type {
  ExamResultsResponse,
} from "@/types/exam-api.types";

export async function getExamResults(
  attemptId: string,
  accessToken: string,
): Promise<ExamResultsResponse> {
  return apiRequest<ExamResultsResponse>(
    `/exams/${encodeURIComponent(attemptId)}/results`,
    accessToken,
    {
      method: "GET",
    },
  );
}
