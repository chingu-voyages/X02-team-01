import { apiRequest } from "@/lib/api-client";

import type { AdminQuestionBankListResponse } from "@/types/admin-question-api.types";

export async function getManagedQuestions(
  token: string,
): Promise<AdminQuestionBankListResponse> {
  return apiRequest<AdminQuestionBankListResponse>(
    "/admin/questions",
    token,
    { method: "GET" },
  );
}
