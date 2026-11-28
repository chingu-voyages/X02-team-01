import type { ExamImage, ExamOption } from "@/types/exam-api.types";
import type { ReviewStatus } from "@/types/exam-review.types";

export const gradeOutcomes = ["correct", "incorrect", "unanswered", "ungraded", "ungradable", "manually_graded"] as const;

export interface CompletedQuestionReview {
  attempt_id: string;
  attempt_status: "submitted";
  question_count: number;
  question_version_id: string;
  position: number;
  question_text: string;
  question_type: "multiple_choice" | "short_answer";
  allows_multiple_answers: boolean;
  question_status: ReviewStatus;
  options: ExamOption[];
  images: ExamImage[];
  submitted_response: {
    selected_option_ids: string[];
    text_response: string | null;
    is_submitted: true;
    answered_at: string;
    question_submitted_at: string | null;
  } | null;
  correct_option_ids: string[] | null;
  explanation: string | null;
  grading: {
    outcome: (typeof gradeOutcomes)[number];
    points_earned: number;
    max_points: number | null;
    feedback: string | null;
  } | null;
}
