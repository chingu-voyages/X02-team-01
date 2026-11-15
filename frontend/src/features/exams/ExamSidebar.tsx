import { Button } from "@/components/ui/button";
import type { ExamQuestionWithResponse, FeedbackEntry } from "@/types/exam-api.types";

function letterForPosition(position: number) {
  return position >= 1 && position <= 26
    ? String.fromCharCode(64 + position)
    : String(position);
}

interface ExamSidebarProps {
  currentQuestion: ExamQuestionWithResponse;
  currentQuestionIndex: number;
  totalQuestions: number;
  submittedCount: number;
  selectedOptionIds: string[];
  isSubmitted: boolean;
  isSubmitting: boolean;
  isFinishing: boolean;
  allQuestionsSubmitted: boolean;
  finishError: string;
  feedback?: FeedbackEntry;
  onFinish: () => void;
}

export default function ExamSidebar({
  currentQuestion,
  currentQuestionIndex,
  totalQuestions,
  submittedCount,
  selectedOptionIds,
  isSubmitted,
  isSubmitting,
  isFinishing,
  allQuestionsSubmitted,
  finishError,
  feedback,
  onFinish,
}: ExamSidebarProps) {
  const isShortAnswer = currentQuestion.question_type === "short_answer";
  const isMultiple = currentQuestion.allows_multiple_answers;
  const isLastQuestion = currentQuestionIndex >= totalQuestions - 1;

  const selectedLetters = currentQuestion.options
    .filter((option) => selectedOptionIds.includes(option.id))
    .map((option) => letterForPosition(option.position))
    .join(", ");

  return (
    <aside
      aria-labelledby="attempt-progress-heading"
      className="rounded-md border border-[#cbd0d3] bg-white p-5 sm:p-6"
    >
      <h2 id="attempt-progress-heading" className="text-base font-bold">
        Attempt progress
      </h2>
      <div className="mt-4 space-y-3 text-sm text-[#56616a]">
        <p>
          Question {currentQuestionIndex + 1} / {totalQuestions}
        </p>
        <p>
          Submitted answers: {submittedCount} / {totalQuestions}
        </p>
        <p>
          {isSubmitted
            ? isShortAnswer
              ? "Submitted: short answer"
              : `Submitted answer${isMultiple ? "s" : ""}: ${selectedLetters || "recorded"}`
            : "Current question not yet submitted"}
        </p>
      </div>
      <div className="my-5 border-t border-[#e2e5e7]" />

      {isLastQuestion && allQuestionsSubmitted ? (
        <Button
          type="button"
          onClick={onFinish}
          disabled={isFinishing || isSubmitting}
          className="h-10 rounded-md bg-[#343a3e] px-5 text-sm text-white hover:bg-[#1e2427] disabled:opacity-50"
        >
          {isFinishing ? "Finishing exam..." : "Finish Exam"}
        </Button>
      ) : (
        <p className="text-sm text-[#687178]">
          Submit all questions to enable Finish Exam.
        </p>
      )}

      {finishError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {finishError}
        </p>
      )}

      {isSubmitted && (
        <p className="mt-4 text-xs leading-5 text-[#687178]">
          {typeof feedback?.is_correct === "boolean"
            ? feedback.is_correct
              ? "✓ Correct · Answer locked for this attempt."
              : "× Incorrect · Answer locked for this attempt."
            : "✓ Answer saved · Locked for this attempt."}
        </p>
      )}
    </aside>
  );
}

