import {
  apiRequest,
} from "@/lib/api-client";

import type {
  AdminQuestionBankListResponse,
  AdminQuestionDetail,
  AdminQuestionDraftCreateRequest,
  AdminQuestionDraftCreated,
  AdminQuestionDraftEditRequest,
  AdminQuestionImage,
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
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}`,
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
      body: JSON.stringify(
        payload,
      ),
    },
  );
}


export async function editManagedQuestion(
  token: string,
  questionId: string,
  payload: AdminQuestionDraftEditRequest,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify(
        payload,
      ),
    },
  );
}


export async function uploadManagedQuestionImage(
  token: string,
  questionId: string,
  file: File,
  altText: string,
): Promise<AdminQuestionImage> {
  const formData =
    new FormData();

  formData.append(
    "file",
    file,
  );

  formData.append(
    "alt_text",
    altText,
  );

  return apiRequest<AdminQuestionImage>(
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/images`,
    token,
    {
      method: "POST",
      body: formData,
    },
  );
}


export async function replaceManagedQuestionImage(
  token: string,
  questionId: string,
  imageId: string,
  file: File,
  altText: string,
): Promise<AdminQuestionImage> {
  const formData =
    new FormData();

  formData.append(
    "file",
    file,
  );

  formData.append(
    "alt_text",
    altText,
  );

  return apiRequest<AdminQuestionImage>(
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/images/${encodeURIComponent(
      imageId,
    )}`,
    token,
    {
      method: "PATCH",
      body: formData,
    },
  );
}


export async function removeManagedQuestionImage(
  token: string,
  questionId: string,
  imageId: string,
): Promise<void> {
  return apiRequest<void>(
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/images/${encodeURIComponent(
      imageId,
    )}`,
    token,
    {
      method: "DELETE",
    },
  );
}


export async function publishManagedQuestion(
  token: string,
  questionId: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/publish`,
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
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/reject`,
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
    `/admin/questions/${encodeURIComponent(
      questionId,
    )}/retire`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        confirm: true,
      }),
    },
  );
}


export async function submitManagedQuestion(
  token: string,
  questionId: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}/submit`,
    token,
    {
      method: "POST",
    },
  );
}

export async function startQuestionReview(
  token: string,
  questionId: string,
): Promise<AdminQuestionDetail> {
  return apiRequest<AdminQuestionDetail>(
    `/admin/questions/${encodeURIComponent(questionId)}/start-review`,
    token,
    {
      method: "POST",
    },
  );
}
