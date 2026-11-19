import {
  apiRequest,
} from "@/lib/api-client";

import type {
  QuestionImportAssetUploadResponse,
  QuestionImportBatch,
  QuestionImportCommitResponse,
  QuestionImportRowsPage,
  QuestionImportRowsQuery,
} from "@/types/question-import-api.types";


function rowsQueryString(
  query: QuestionImportRowsQuery,
) {
  const params =
    new URLSearchParams();

  if (query.row_status) {
    params.set(
      "row_status",
      query.row_status,
    );
  }

  if (query.page !== undefined) {
    params.set(
      "page",
      String(query.page),
    );
  }

  if (query.page_size !== undefined) {
    params.set(
      "page_size",
      String(query.page_size),
    );
  }

  const value = params.toString();

  return value
    ? `?${value}`
    : "";
}


export async function uploadQuestionImport(
  token: string,
  file: File,
): Promise<QuestionImportBatch> {
  const formData =
    new FormData();

  formData.append(
    "file",
    file,
  );

  return apiRequest<QuestionImportBatch>(
    "/admin/question-imports",
    token,
    {
      method: "POST",
      body: formData,
    },
  );
}


export async function getQuestionImport(
  token: string,
  batchId: string,
): Promise<QuestionImportBatch> {
  return apiRequest<QuestionImportBatch>(
    `/admin/question-imports/${encodeURIComponent(
      batchId,
    )}`,
    token,
    {
      method: "GET",
    },
  );
}


export async function getQuestionImportRows(
  token: string,
  batchId: string,
  query: QuestionImportRowsQuery = {},
): Promise<QuestionImportRowsPage> {
  return apiRequest<QuestionImportRowsPage>(
    `/admin/question-imports/${encodeURIComponent(
      batchId,
    )}/rows${rowsQueryString(
      query,
    )}`,
    token,
    {
      method: "GET",
    },
  );
}


export async function uploadQuestionImportAsset(
  token: string,
  batchId: string,
  file: File,
): Promise<QuestionImportAssetUploadResponse> {
  const formData =
    new FormData();

  formData.append(
    "file",
    file,
  );

  return apiRequest<QuestionImportAssetUploadResponse>(
    `/admin/question-imports/${encodeURIComponent(
      batchId,
    )}/assets`,
    token,
    {
      method: "POST",
      body: formData,
    },
  );
}


export async function commitQuestionImport(
  token: string,
  batchId: string,
): Promise<QuestionImportCommitResponse> {
  return apiRequest<QuestionImportCommitResponse>(
    `/admin/question-imports/${encodeURIComponent(
      batchId,
    )}/commit`,
    token,
    {
      method: "POST",
    },
  );
}
