import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuestionControlsProps {
  questionIndex: number;
  totalQuestions: number;
  selectedCount: number;
  isSubmitted: boolean;
  isSubmitting: boolean;
  isFinishing: boolean;
  isSavingFlag?: boolean;
  allQuestionsSubmitted: boolean;
  firstUnsubmittedIndex: number;
  onSubmit: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReviewUnsubmitted: () => void;
}

export default function QuestionControls({
  questionIndex,
  totalQuestions,
  selectedCount,
  isSubmitted,
  isSubmitting,
  isFinishing,
  isSavingFlag = false,
  allQuestionsSubmitted,
  firstUnsubmittedIndex,
  onSubmit,
  onPrevious,
  onNext,
  onReviewUnsubmitted,
}: QuestionControlsProps) {
  const isLastQuestion = questionIndex >= totalQuestions - 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <Button
        type="button"
        variant="outline"
        onClick={onPrevious}
        disabled={questionIndex === 0 || isSubmitting || isFinishing}
        className="min-h-11 cursor-pointer rounded-xl border border-brand-primary/45 bg-white px-5 text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Previous
      </Button>

      <div className="flex items-center gap-3">
        {isSubmitted ? (
          isLastQuestion ? (
            allQuestionsSubmitted ? (
              <span className="text-sm text-brand-text/70">
                All answers submitted. Finish the exam in the progress panel.
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={onReviewUnsubmitted}
                disabled={isFinishing || firstUnsubmittedIndex < 0}
                className="min-h-11 cursor-pointer rounded-xl border border-brand-primary/45 bg-white px-5 text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                Review unanswered questions
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={onNext}
              disabled={isFinishing}
              className="min-h-11 cursor-pointer rounded-xl bg-brand-primary px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next Question
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          )
        ) : (
          <Button
            type="button"
            disabled={
              selectedCount === 0 ||
              isSubmitting ||
              isFinishing ||
              isSavingFlag
            }
            onClick={onSubmit}
            className="min-h-11 cursor-pointer rounded-xl bg-brand-primary px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit answer"}
          </Button>
        )}
      </div>
    </div>
  );
}