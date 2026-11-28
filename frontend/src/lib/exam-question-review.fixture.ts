import type { CompletedQuestionReview } from "@/types/exam-question-review.types";

export const attemptId = "11111111-1111-4111-8111-111111111111";
export const versionId = "22222222-2222-4222-8222-222222222222";
export const otherId = "33333333-3333-4333-8333-333333333333";
export const firstId = "44444444-4444-4444-8444-444444444444";
export const secondId = "55555555-5555-4555-8555-555555555555";
export const thirdId = "66666666-6666-4666-8666-666666666666";
export const detail: CompletedQuestionReview = {
  attempt_id: attemptId, attempt_status: "submitted", question_version_id: versionId, question_count: 2, position: 1,
  question_text: "Which statements are true? Δx² = 4 · 日本語", question_type: "multiple_choice", allows_multiple_answers: true,
  question_status: "incorrect", options: [
    { id: firstId, position: 1, option_text: "First correct option" },
    { id: secondId, position: 2, option_text: "Incorrect option" },
    { id: thirdId, position: 3, option_text: "Missed correct option" },
  ], images: [], correct_option_ids: [firstId, thirdId], explanation: "Both correct options are required.\nΔx² = 4",
  submitted_response: { selected_option_ids: [firstId, secondId], text_response: null, is_submitted: true, answered_at: "2026-11-28T08:00:00Z", question_submitted_at: null },
  grading: { outcome: "incorrect", points_earned: 0, max_points: 1, feedback: null },
};
