// Matches the learner exam API, including JHEP-120's distinct essay type.
// Images are nullable when a media delivery base URL has not been configured.
export type ExamCreateRequest = {
  certification_id: string;
  category_id?: string;
  practice_exam_id?: string;
  question_count: number;
};

export type ExamOption = {
  id: string;
  position: number;
  option_text: string;
};

export type ExamImage = {
  id: string;
  position: number;
  alt_text: string;
  media_type: "image/png" | "image/jpeg" | "image/webp";
  url: string | null;
};

export type ExamQuestion = {
  id: string; // Question VERSION ID, not parent question ID.
  position: number;
  question_text: string;
  question_type: "multiple_choice" | "short_answer" | "essay";
  allows_multiple_answers: boolean;
  difficulty: "easy" | "medium" | "hard";
  options: ExamOption[];
  images: ExamImage[];
  flagged_for_review?: boolean;
};

export type QuestionFlagSaved = {
  attempt_id: string;
  question_version_id: string;
  flagged_for_review: boolean;
};

export type ExamCreatedResponse = {
  attempt_id: string;
  certification_id: string;
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

export type ResponseBlock = {
  question_version_id: string;
  selected_option_ids: string[] | null;
  text_response: string | null;
  is_submitted: boolean;
  answered_at: string;
  // Null/absent is unknown, never an incorrect answer.
  is_correct?: boolean | null;
};

export type ExamQuestionWithResponse = ExamQuestion & {
  response?: ResponseBlock | null;
};

export type ExamAttempt = {
  attempt_id: string;
  certification_id: string;
  status: "in_progress" | "submitted";
  question_count: number;
  current_position: number;
  questions: ExamQuestionWithResponse[];
};

export type QuestionFeedback = {
  // Optional for compatibility with existing fixtures; the current API sends it.
  attempt_id?: string;
  question_version_id: string;
  is_submitted: true;
  question_submitted_at?: string | null;
  feedback_released: boolean;
  is_correct?: boolean | null;
  correct_option_ids?: string[] | null;
  explanation?: string | null;
};

export type AnswerSubmission = {
  selected_option_ids?: string[] | null;
  text_response?: string | null;
};

export interface FeedbackEntry {
  feedback_released: boolean;
  is_correct: boolean | null;
  correct_option_ids: string[];
  explanation?: string | null;
}
