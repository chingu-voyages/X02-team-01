import { apiRequest } from "@/lib/api-client";
import type { QuestionImportBatch } from "@/types/question-import-api.types";

export interface ImportCatalogPlan {
  batch_id: string;
  plan_id: string;
  missing_certifications: { code: string; row_numbers: number[] }[];
  missing_categories: {
    certification_code: string;
    name: string;
    row_numbers: number[];
  }[];
  blocking_issues: { row_number: number; field: string; message: string }[];
  can_confirm: boolean;
}

export interface ImportCertificationConfiguration {
  code: string;
  name: string;
  passing_threshold_pct: number;
  feedback_mode: "immediate" | "deferred";
}

export interface ImportCatalogConfirmation {
  plan_id: string;
  confirm: true;
  certifications: ImportCertificationConfiguration[];
}

export interface ImportCatalogConfirmationResponse {
  batch: QuestionImportBatch;
  created_certification_ids: string[];
  created_category_ids: string[];
}

export function getImportCatalogPlan(
  token: string,
  batchId: string,
): Promise<ImportCatalogPlan> {
  return apiRequest<ImportCatalogPlan>(
    `/admin/question-imports/${encodeURIComponent(batchId)}/catalog-plan`,
    token,
    { method: "GET", cache: "no-store" },
  );
}

export function confirmImportCatalog(
  token: string,
  batchId: string,
  payload: ImportCatalogConfirmation,
): Promise<ImportCatalogConfirmationResponse> {
  return apiRequest<ImportCatalogConfirmationResponse>(
    `/admin/question-imports/${encodeURIComponent(batchId)}/catalog-confirm`,
    token,
    { method: "POST", body: JSON.stringify(payload) },
  );
}
