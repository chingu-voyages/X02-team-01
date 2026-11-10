export type AdminQuestionType = "multiple_choice" | "short_answer";
export type AdminReviewStatus = "pending" | "approved" | "rejected";
export type AdminPublicationStatus = "draft" | "active" | "retired";
export type AdminDifficulty = "easy" | "medium" | "hard";

export interface AdminQuestionBankItem {
  question_id: string;
  question_version_id: string;
  version_number: number;
  question_preview: string;
  certification_id: string;
  certification_name: string;
  category_id: string | null;
  category_name: string | null;
  difficulty: AdminDifficulty;
  question_type: AdminQuestionType;
  review_status: AdminReviewStatus;
  publication_status: AdminPublicationStatus;
  is_flagged: boolean;
  created_by_id: string;
  last_updated: string;
}

export interface AdminQuestionBankListResponse {
  items: AdminQuestionBankItem[];
  count: number;
}
