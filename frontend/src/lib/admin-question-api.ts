import { apiRequest } from "@/lib/api-client";

import type {
  AdminQuestionBankListResponse,
  AdminQuestionDetail,
  AdminQuestionDraftCreateRequest,
  AdminQuestionDraftCreated,
  AdminQuestionDraftEditRequest,
  AdminQuestionRetirementResponse,
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

export async function publishManagedQuestion(
  token: string,
  questionId: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}/publish`,
    token,
    {
      method: "POST",
    },
  );
}

export async function rejectManagedQuestion(
  token: string,
  questionId: string,
  reviewNote: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}/reject`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        review_note: reviewNote,
      }),
    },
  );
}

export async function retireManagedQuestion(
  token: string,
  questionId: string,
): Promise<AdminQuestionRetirementResponse> {
  return apiRequest<AdminQuestionRetirementResponse>(
    `/admin/questions/${encodeURIComponent(questionId)}/retire`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        confirm: true,
      }),
    },
  );
}