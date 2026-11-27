/** JHEP-107/126 admin exam configuration and publication contracts (the backend's AdminPracticeExamOut). */
export type PracticeExamStatus = "draft" | "published" | "unpublished";

export interface PracticeExamReadinessIssue {
  code: string;
  message: string;
}

export interface PracticeExamReadiness {
  ready: boolean;
  required_question_count: number | null;
  eligible_question_count: number;
  issues: PracticeExamReadinessIssue[];
}

export interface AdminPracticeExam {
  id: string;
  certification_id: string;
  certification_name: string;
  category_id: string;
  category_name: string;
  name: string;
  question_count: number | null;
  status: PracticeExamStatus;
  readiness: PracticeExamReadiness;
}

export interface AdminPracticeExamListResponse {
  items: AdminPracticeExam[];
  count: number;
}

/** Create a draft with its initial configured count. */
export interface AdminPracticeExamCreateRequest {
  certification_id: string;
  category_id: string;
  name: string;
  question_count: number;
}

/** JHEP-107: full configuration replacement; a valid count is required. */
export type AdminPracticeExamConfigurationUpdateRequest = AdminPracticeExamCreateRequest;

export interface PracticeExamNotReadyDetail {
  code: "PRACTICE_EXAM_NOT_READY";
  message: string;
  readiness: PracticeExamReadiness;
}
