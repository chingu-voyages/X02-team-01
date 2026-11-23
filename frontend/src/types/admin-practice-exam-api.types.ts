/** JHEP-126 admin exam publication contracts (the backend's AdminPracticeExamOut). */
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

/** Creating a draft supports its initial count. Later editing is JHEP-107. */
export interface AdminPracticeExamCreateRequest {
  certification_id: string;
  category_id: string;
  name: string;
  question_count: number;
}

export interface PracticeExamNotReadyDetail {
  code: "PRACTICE_EXAM_NOT_READY";
  message: string;
  readiness: PracticeExamReadiness;
}
