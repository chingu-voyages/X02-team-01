export type AdminQuestionType =
  | "multiple_choice"
  | "short_answer";

export type AdminReviewStatus =
  | "pending"
  | "approved"
  | "rejected";

export type AdminPublicationStatus =
  | "draft"
  | "active"
  | "retired";

export type AdminDifficulty =
  | "easy"
  | "medium"
  | "hard";

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
  has_image: boolean;
  created_by_id: string;
  last_updated: string;
}

export interface AdminQuestionBankListResponse {
  items: AdminQuestionBankItem[];
  count: number;
}

export interface AdminQuestionBankQuery {
  search?: string;
  certification_id?: string;
  category_id?: string;
  difficulty?: AdminDifficulty;
  question_type?: AdminQuestionType;
  review_status?: AdminReviewStatus;
  publication_status?: AdminPublicationStatus;
  has_image?: boolean;
  page?: number;
  page_size?: number;
}

export interface AdminAnswerOption {
  position: number;
  option_text: string;
  is_correct: boolean;
}

export interface AdminQuestionImage {
  id: string;
  question_version_id: string;
  position: number;
  alt_text: string;
  media_type:
    | "image/png"
    | "image/jpeg"
    | "image/webp";
  url: string | null;
}

export interface AdminQuestionDetail {
  question_id: string;
  question_version_id: string;
  version_number: number;

  certification_id: string;
  certification_name: string;

  category_id: string | null;
  category_name: string | null;

  difficulty: AdminDifficulty;

  question_text: string;
  question_type: AdminQuestionType;

  allows_multiple_answers: boolean;

  explanation: string | null;

  review_status: AdminReviewStatus;
  publication_status: AdminPublicationStatus;

  is_flagged: boolean;

  created_by_id: string;
  submitted_by_id: string;

  last_updated: string;

  options: AdminAnswerOption[];

  expected_answer: string | null;

  images: AdminQuestionImage[];
}

export interface AdminAnswerOptionInput {
  option_text: string;
  is_correct: boolean;
}

export interface AdminQuestionDraftCreateRequest {
  certification_id: string;
  category_id: string | null;
  difficulty: AdminDifficulty;
  question_text: string;
  question_type: AdminQuestionType;
  allows_multiple_answers: boolean;
  explanation: string | null;
  options: AdminAnswerOptionInput[];
  expected_answer: string | null;
}

export interface AdminQuestionDraftEditRequest {
  category_id: string | null;
  difficulty: AdminDifficulty;
  question_text: string;
  question_type: AdminQuestionType;
  allows_multiple_answers: boolean;
  explanation: string | null;
  options: AdminAnswerOptionInput[];
  expected_answer: string | null;
}

export interface AdminQuestionDraftCreated {
  question_id: string;
  question_version_id: string;
  version_number: number;
  review_status: "pending";
  publication_status: "draft";
}

export interface AdminQuestionRetirementResponse {
  question_id: string;
  retired_version_ids: string[];
  publication_status: "retired";
  already_retired: boolean;
}
