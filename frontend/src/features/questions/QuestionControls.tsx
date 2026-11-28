"use client";

import { useEffect, useId, useRef } from "react";
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
  submitBlocked?: boolean;
  submitHint?: string;
  allowDraftNavigation?: boolean;
  readOnly?: boolean;
  finishError?: string;
  onFinish?: () => void;
  onSubmit: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReviewUnsubmitted: () => void;
}

const primaryClass = "min-h-11 h-auto w-full cursor-pointer whitespace-normal rounded-xl bg-brand-primary px-5 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
const secondaryClass = "min-h-11 h-auto w-full cursor-pointer whitespace-normal rounded-xl border border-brand-primary/45 bg-white px-5 py-3 text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

export default function QuestionControls({
  questionIndex, totalQuestions, selectedCount, isSubmitted, isSubmitting,
  isFinishing, isSavingFlag = false, allQuestionsSubmitted, firstUnsubmittedIndex,
  submitBlocked = false, submitHint = "", allowDraftNavigation = false,
  readOnly = false, finishError = "", onFinish,
  onSubmit, onPrevious, onNext, onReviewUnsubmitted,
}: QuestionControlsProps) {
  const isLastQuestion = questionIndex >= totalQuestions - 1;
  const hintId = useId();
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const previousStateRef = useRef({ questionIndex, isSubmitted });
  useEffect(() => {
    const previous = previousStateRef.current;
    if (previous.questionIndex === questionIndex && !previous.isSubmitted && isSubmitted) {
      // Submit is replaced by Next/Review/Finish. Keep keyboard focus in the flow.
      nextActionRef.current?.focus({ preventScroll: true });
    }
    previousStateRef.current = { questionIndex, isSubmitted };
  }, [questionIndex, isSubmitted]);

  return (
    <div className="min-w-0 space-y-3 pt-1">
      {!readOnly && !isSubmitted && submitHint && <p id={hintId} className="text-sm leading-6 text-brand-text/80">{submitHint}</p>}
      <div role="group" aria-label="Answer and navigation controls" className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={onPrevious}
          disabled={questionIndex === 0 || isSubmitting || isFinishing} className={secondaryClass}>
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />Previous
        </Button>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {!readOnly && !isSubmitted && allowDraftNavigation && !isLastQuestion && (
            <Button type="button" variant="outline" onClick={onNext}
              disabled={isSubmitting || isFinishing} className={secondaryClass}>
              Next without submitting<ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Button>
          )}
          {readOnly ? (
            isLastQuestion ? (
              <span className="text-sm text-brand-text/70">This exam is complete. View results to check feedback.</span>
            ) : (
              <Button ref={nextActionRef} type="button" onClick={onNext} disabled={isFinishing} className={secondaryClass}>
                Next Question<ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Button>
            )
          ) : isSubmitted ? (
            onFinish && allQuestionsSubmitted ? (
              <Button ref={nextActionRef} type="button" onClick={onFinish}
                disabled={readOnly || isFinishing || isSubmitting || isSavingFlag} className={primaryClass}>
                {isFinishing ? "Finishing exam..." : "Finish Exam"}
              </Button>
            ) : isLastQuestion ? (
              allQuestionsSubmitted ? (
                <span className="text-sm text-brand-text/70">All answers submitted. Finish the exam in the progress panel.</span>
              ) : (
                <Button ref={nextActionRef} type="button" variant="outline" onClick={onReviewUnsubmitted}
                  disabled={isFinishing || firstUnsubmittedIndex < 0} className={secondaryClass}>
                  Review unanswered questions
                </Button>
              )
            ) : (
              <Button ref={nextActionRef} type="button" onClick={onNext} disabled={isFinishing} className={primaryClass}>
                Next Question<ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Button>
            )
          ) : (
            <Button type="button" disabled={readOnly || selectedCount === 0 || submitBlocked || isSubmitting || isFinishing || isSavingFlag}
              aria-describedby={submitHint ? hintId : undefined} onClick={onSubmit} className={primaryClass}>
              {isSubmitting ? "Submitting..." : "Submit answer"}
            </Button>
          )}
        </div>
      </div>
      {onFinish && allQuestionsSubmitted && !readOnly && (
        <p className="text-sm leading-6 text-brand-text/80">All answers are submitted. Finish the exam to view results and send essays for review.</p>
      )}
      {finishError && <p role="alert" className="text-sm leading-6 text-red-700">{finishError}</p>}
    </div>
  );
}
