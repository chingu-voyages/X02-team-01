// JHEP-37: preview-only contract, distinct from the full results breakdown.
export const reviewStatuses = [
  "correct",
  "incorrect",
  "unanswered",
  "pending_manual_grading",
  "manually_graded",
  "unavailable",
] as const;

export type ReviewStatus = (typeof reviewStatuses)[number];

export interface ReviewQuestion {
  question_version_id: string;
  position: number;
  preview: string;
  status: ReviewStatus;
}

export interface CompletedExamReview {
  attempt_id: string;
  status: "submitted";
  question_count: number;
  questions: ReviewQuestion[];
}
