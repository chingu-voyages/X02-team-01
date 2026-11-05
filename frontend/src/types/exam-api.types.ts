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

export type ExamResultsResponse = {
  attempt_id: string;
  status: "submitted";
  correct_count: number;
  incorrect_count: number;
  score_percent: number | null;
  passing_score_percent: number | null;
  passed: boolean | null;
  grading_complete: boolean;
};

// --- JHEP-99: live exam interface (resume + per-question feedback) ---

export type ResponseBlock = {
  question_version_id: string;
  selected_option_ids: string[] | null;
  text_response: string | null;
  is_submitted: boolean;
  answered_at: string;
  // Present only after grading released it (immediate mode or a graded
  // attempt); its absence must never be read as a wrong answer.
  is_correct?: boolean;
};

export type ExamQuestionWithResponse = ExamQuestion & {
  response?: ResponseBlock;
};

export type ExamAttempt = {
  attempt_id: string; // UUID
  certification_id: string; // UUID
  status: "in_progress" | "submitted";
  question_count: number;
  current_position: number;
  questions: ExamQuestionWithResponse[];
};

export type QuestionFeedback = {
  question_version_id: string; // UUID
  is_submitted: true;
  question_submitted_at?: string;
  feedback_released: boolean;
  is_correct?: boolean;
  correct_option_ids?: string[];
  explanation?: string;
};

export type AnswerSubmission = {
  selected_option_ids?: string[] | null;
  text_response?: string | null;
};