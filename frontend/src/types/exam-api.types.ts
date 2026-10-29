// Matches JHEP-29 ExamCreateRequest / ExamCreatedOut after the image checkpoint.
// Images are nullable when a media delivery base URL has not been configured.
export type ExamCreateRequest = {
  certification_id: string; // UUID
  question_count: number; // positive integer, capped by backend config (max 100)
};

export type ExamOption = {
  id: string; // UUID
  position: number;
  option_text: string;
};

export type ExamImage = {
  id: string; // UUID
  position: number;
  alt_text: string;
  media_type: "image/png" | "image/jpeg" | "image/webp";
  url: string | null; // null => display text fallback
};

export type ExamQuestion = {
  id: string; // question VERSION ID, not parent question ID
  position: number; // 1-based order within attempt
  question_text: string;
  question_type: "multiple_choice" | "short_answer";
  allows_multiple_answers: boolean;
  difficulty: "easy" | "medium" | "hard";
  options: ExamOption[];
  images: ExamImage[];
};

export type ExamCreatedResponse = {
  attempt_id: string; // UUID
  certification_id: string; // UUID
  status: "in_progress";
  question_count: number;
  questions: ExamQuestion[];
};

export type InsufficientQuestionsError = {
  detail: {
    code: "INSUFFICIENT_QUESTIONS";
    requested: number;
    available: number;
  };
};
