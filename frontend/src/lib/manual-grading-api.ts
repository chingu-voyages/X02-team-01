import { apiRequest } from "@/lib/api-client";

import type {
  GradingPermissions,
  ManualGradeHistoryResponse,
  ManualGradeQueueResponse,
  ManualGradeSubmitResponse,
  ManualResponseType,
  WrittenResponseDetail,
} from "@/types/exam-api.types";

function responsePath(
  attemptId: string,
  questionVersionId: string,
): string {
  return `/admin/grading/responses/${encodeURIComponent(attemptId)}/${encodeURIComponent(questionVersionId)}`;
}

export async function getGradingPermissions(
  token: string,
): Promise<GradingPermissions> {
  return apiRequest<GradingPermissions>(
    "/admin/grading/permissions",
    token,
    { method: "GET" },
  );
}

export async function getPendingManualResponses(
  token: string,
  responseType?: ManualResponseType,
): Promise<ManualGradeQueueResponse> {
  const query = responseType
    ? `?response_type=${encodeURIComponent(responseType)}`
    : "";

  return apiRequest<ManualGradeQueueResponse>(
    `/admin/grading/pending${query}`,
    token,
    { method: "GET" },
  );
}

export async function getWrittenResponseDetail(
  token: string,
  attemptId: string,
  questionVersionId: string,
): Promise<WrittenResponseDetail> {
  return apiRequest<WrittenResponseDetail>(
    responsePath(attemptId, questionVersionId),
    token,
    { method: "GET" },
  );
}

export async function getWrittenResponseHistory(
  token: string,
  attemptId: string,
  questionVersionId: string,
): Promise<ManualGradeHistoryResponse> {
  return apiRequest<ManualGradeHistoryResponse>(
    `${responsePath(attemptId, questionVersionId)}/history`,
    token,
    { method: "GET" },
  );
}

export async function submitManualGrade(
  token: string,
  attemptId: string,
  questionVersionId: string,
  score: number,
  feedback: string | null,
): Promise<ManualGradeSubmitResponse> {
  return apiRequest<ManualGradeSubmitResponse>(
    `${responsePath(attemptId, questionVersionId)}/grade`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ score, feedback }),
    },
  );
}
