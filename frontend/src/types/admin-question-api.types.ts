export type AdminQuestionType =
  | "multiple_choice"
  | "short_answer"
  | "essay";

export type AdminReviewStatus =
  | "pending"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected";

export type AdminPublicationStatus =
  | "draft"
  | "active"
  | "inactive"
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
  author_email?: string;
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

export interface AdminRubricCriterion {
  position: number;
  name: string;
  points: number;
}

export interface AdminRubricCriterionInput {
  name: string;
  points: number;
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

  review_note: string | null;

  is_flagged: boolean;

  created_by_id: string;
  submitted_by_id: string;

  last_updated: string;

  options: AdminAnswerOption[];

  expected_answer: string | null;

  max_points: number | null;

  criteria_markdown: string | null;

  rubric: AdminRubricCriterion[] | null;

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
  rubric: AdminRubricCriterionInput[] | null;
  max_points: number | null;
  criteria_markdown: string | null;
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
  rubric: AdminRubricCriterionInput[] | null;
  max_points: number | null;
  criteria_markdown: string | null;
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
