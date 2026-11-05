
export interface FinalExamSubmissionResponse {
  attempt_id: string;
  status: "submitted";
  question_count: number;
  answered_count: number;
  unanswered_count: number;
  submitted_at: string;
  results_url: string;
}
