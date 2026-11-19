export type QuestionImportBatchStatus =
  | "uploaded"
  | "validating"
  | "invalid"
  | "ready"
  | "importing"
  | "imported"
  | "failed"
  | "cancelled";

export type QuestionImportRowStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "imported"
  | "failed";

export type QuestionImportIssueSeverity =
  | "error"
  | "warning";

export interface QuestionImportIssue {
  sheet: string | null;
  row: number | null;
  field: string | null;
  cell: string | null;
  severity: QuestionImportIssueSeverity;
  code: string;
  message: string;
  value_preview: string | null;
  related_rows: number[];
  asset_filename: string | null;
}

export interface QuestionImportBatch {
  id: string;
  original_filename: string;
  template_version: string;
  status: QuestionImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  warning_rows: number;
  imported_rows: number;
  can_import: boolean;
  created_at: string;
  validated_at: string | null;
  imported_at: string | null;
}

export interface QuestionImportRow {
  id: string;
  row_number: number;
  status: QuestionImportRowStatus;
  certification_code: string | null;
  category_name: string | null;
  question_type: string | null;
  question_text: string | null;
  image_filename: string | null;
  issues: QuestionImportIssue[];
}

export interface QuestionImportRowsPage {
  items: QuestionImportRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface QuestionImportAsset {
  id: string;
  source_filename: string;
  media_type:
    | "image/png"
    | "image/jpeg"
    | "image/webp";
  byte_size: number;
  status:
    | "uploaded"
    | "valid"
    | "invalid"
    | "committed"
    | "discarded";
}

export interface QuestionImportAssetUploadResponse {
  asset: QuestionImportAsset;
  batch: QuestionImportBatch;
}

export interface QuestionImportCommitResponse {
  batch: QuestionImportBatch;
  created_count: number;
  created_question_ids: string[];
  already_imported: boolean;
}

export interface QuestionImportRowsQuery {
  row_status?: QuestionImportRowStatus;
  page?: number;
  page_size?: number;
}

export interface QuestionImportHistoryItem
  extends QuestionImportBatch {
  uploaded_by_id: string;
  uploaded_by_email: string;
  uploaded_by_name: string;
}

export interface QuestionImportHistoryPage {
  items: QuestionImportHistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface QuestionImportHistoryQuery {
  status?: QuestionImportBatchStatus;
  page?: number;
  page_size?: number;
}

