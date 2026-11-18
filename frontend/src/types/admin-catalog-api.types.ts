export type AdminFeedbackMode =
  | "immediate"
  | "deferred";

export interface AdminCertification {
  id: string;
  name: string;
  code: string;
  passing_threshold_pct: number | null;
  feedback_mode: AdminFeedbackMode;
  is_published: boolean;
}

export interface AdminCertificationListResponse {
  items: AdminCertification[];
  count: number;
}

export interface AdminCertificationCreateRequest {
  name: string;
  code: string;
  passing_threshold_pct: number;
  feedback_mode: AdminFeedbackMode;
}

export interface AdminCategory {
  id: string;
  certification_id: string;
  certification_name: string;
  name: string;
  is_published: boolean;
}

export interface AdminCategoryListResponse {
  items: AdminCategory[];
  count: number;
}

export interface AdminCategoryCreateRequest {
  certification_id: string;
  name: string;
}