import { apiRequest } from "@/lib/api-client";

import type {
  AdminQuestionBankListResponse,
  AdminQuestionDetail,
  AdminQuestionDraftCreateRequest,
  AdminQuestionDraftCreated,
  AdminQuestionDraftEditRequest,
} from "@/types/admin-question-api.types";

export async function getManagedQuestions(
  token: string,
): Promise<AdminQuestionBankListResponse> {
  return apiRequest<AdminQuestionBankListResponse>(
    "/admin/questions",
    token,
    {
      method: "GET",
    },
  );
}

export async function getManagedQuestion(
  token: string,
  questionId: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}`,
    token,
    {
      method: "GET",
    },
  );
}

export async function createManagedQuestion(
  token: string,
  payload: AdminQuestionDraftCreateRequest,
): Promise<AdminQuestionDraftCreated> {
  return apiRequest<AdminQuestionDraftCreated>(
    "/admin/questions",
    token,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function editManagedQuestion(
  token: string,
  questionId: string,
  payload: AdminQuestionDraftEditRequest,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}