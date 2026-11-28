// Matches JHEP-29 ExamCreateRequest / ExamCreatedOut after the image checkpoint.
// Images are nullable when a media delivery base URL has not been configured.
export type ExamCreateRequest = {
  certification_id: string; // UUID
  category_id?: string; // UUID
  practice_exam_id?: string; // UUID; JHEP-126 published exam
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
  // JHEP-104: older fixtures and API deployments omit this field.
  // Only an explicit true means flagged.
  flagged_for_review?: boolean;
};

export type QuestionFlagSaved = {
  attempt_id: string;
  question_version_id: string;
  flagged_for_review: boolean;
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
  pending_manual_grading_count?: number;
  questions?: QuestionResult[];
};

export type QuestionResult = {
  attempt_id: string;
  question_version_id: string;
  position: number;
  question_text: string;
  response_type: string;
  outcome: string;
  status: "graded" | "pending_manual_grading" | "unavailable";
  points_earned: number;
  max_points: number;
  feedback: string | null;
  learner_response: string | null;
};

export type ManualResponseType = "short_answer" | "essay";

export type GradingPermissions = {
  short_answer: boolean;
  essay: boolean;
};

export type PendingManualResponse = {
  attempt_id: string;
  question_version_id: string;
  response_type: ManualResponseType;
  learner_email: string | null;
  learner_name: string | null;
  question_preview: string;
  submitted_at: string | null;
  max_points: number;
};

export type ManualGradeQueueResponse = {
  items: PendingManualResponse[];
  count: number;
};

export type ManualGradeHistoryItem = {
  grader_role: string;
  action: "graded" | "revised";
  score: number;
  max_points: number;
  feedback: string | null;
  created_at: string;
};

export type ManualGradeHistoryResponse = {
  items: ManualGradeHistoryItem[];
  count: number;
};

export type WrittenResponseDetail = {
  attempt_id: string;
  question_version_id: string;
  response_type: ManualResponseType;
  question_text: string;
  learner_response: string;
  expected_answer: string | null;
  max_points: number;
  current_grade: {
    outcome: string | null;
    points_earned: number | null;
    feedback: string | null;
    graded_by_id: string | null;
    grader_role: string | null;
    max_points: number | null;
    graded_at: string | null;
  } | null;
  history: ManualGradeHistoryItem[];
  provisional_ai_feedback: {
    available: boolean;
    label: string;
    content: string | null;
  };
};

export type ManualGradeSubmitResponse = {
  attempt_id: string;
  question_version_id: string;
  outcome: "manually_graded";
  score: number;
  max_points: number;
  feedback: string | null;
  grader_role: string;
  action: "graded" | "revised";
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
  recovery_revision?: number;
  attempt_id: string; // UUID
  certification_id: string; // UUID
  status: "in_progress" | "submitted";
  question_count: number;
  current_position: number;
  questions: ExamQuestionWithResponse[];
};

export type QuestionFeedback = {
  recovery_revision?: number;
  question_version_id: string; // UUID
  is_submitted: true;
  question_submitted_at?: string;
  feedback_released: boolean;
  is_correct?: boolean;
  correct_option_ids?: string[];
  explanation?: string;
};

export type AnswerSubmission = {
  expected_revision?: number;
  selected_option_ids?: string[] | null;
  text_response?: string | null;
};

export interface FeedbackEntry {
  feedback_released: boolean;
  is_correct: boolean | null;
  correct_option_ids: string[];
  explanation?: string | null;
}
