"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  ExamQuestionWithResponse,
  FeedbackEntry,
} from "@/types/exam-api.types";
import type { QuestionState } from "@/lib/question-states";
import QuestionNavigator from "./QuestionNavigator";

interface ExamSidebarProps {
  currentQuestion: ExamQuestionWithResponse;
  currentQuestionIndex: number;
  totalQuestions: number;
  questionStates?: readonly QuestionState[];
  flaggedQuestionIndices?: readonly number[];
  isSubmitted: boolean;
  isSubmitting: boolean;
  isFinishing: boolean;
  isLeaving?: boolean;
  isSavingFlag?: boolean;
  allQuestionsSubmitted: boolean;
  finishError: string;
  feedback?: FeedbackEntry;
  variant?: "mobile" | "panel";
  onNavigate: (index: number) => boolean | void;
  onFinish: () => void;
}

export default function ExamSidebar({
  currentQuestionIndex,
  totalQuestions,
  questionStates,
  flaggedQuestionIndices = [],
  isSubmitted,
  isSubmitting,
  isFinishing,
  isLeaving = false,
  isSavingFlag = false,
  allQuestionsSubmitted,
  finishError,
  feedback,
  variant = "panel",
  onNavigate,
  onFinish,
}: ExamSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const disclosurePanelId = useId();
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  const isLastQuestion = currentQuestionIndex >= totalQuestions - 1;
  const navigationDisabled = isSubmitting || isFinishing || isLeaving;

  function closeMobileNavigation() {
    // Return focus before removing the selected tile. ExamHeader moves focus
    // to the new question heading when the active question actually changes.
    mobileTriggerRef.current?.focus({ preventScroll: true });
    setMobileOpen(false);
  }

  const finishSection = (
    <>
      <div className="my-5 border-t border-brand-border" />

      {isLastQuestion && allQuestionsSubmitted ? (
        <Button
          type="button"
          onClick={onFinish}
          disabled={isFinishing || isSubmitting || isSavingFlag || isLeaving}
          className="min-h-11 w-full cursor-pointer rounded-xl bg-brand-primary px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFinishing ? "Finishing exam..." : "Finish Exam"}
        </Button>
      ) : (
        <p className="text-xs leading-5 text-brand-text/70">
          {allQuestionsSubmitted
            ? `All answers submitted. Go to question ${totalQuestions} to finish the exam.`
            : "Submit all questions to enable Finish Exam."}
        </p>
      )}

      {finishError && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {finishError}
        </p>
      )}

      {isSubmitted && (
        <p className="mt-3 text-xs leading-5 text-brand-text/70">
          {typeof feedback?.is_correct === "boolean"
            ? feedback.is_correct
              ? "✓ Correct · Answer locked for this attempt."
              : "× Incorrect · Answer locked for this attempt."
            : "Answer saved · Locked for this attempt."}
        </p>
      )}
    </>
  );

  if (variant === "mobile") {
    return (
      <div className="md:hidden">
        <div className="overflow-hidden rounded-2xl border border-brand-border bg-white text-brand-text shadow-xs">
          <button
            ref={mobileTriggerRef}
            type="button"
            aria-expanded={mobileOpen}
            aria-controls={disclosurePanelId}
            disabled={totalQuestions === 0}
            onClick={() => setMobileOpen((open) => !open)}
            onKeyDown={(event) => {
              if (mobileOpen && event.key === "Escape") {
                event.preventDefault();
                closeMobileNavigation();
              }
            }}
            className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold text-brand-text transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>
              Question navigation ·{" "}
              <span className="font-medium text-brand-text/70">
                {currentQuestionIndex + 1} of {totalQuestions}
              </span>
            </span>

            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 text-brand-primary transition-transform duration-200 ${
                mobileOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          <section
            id={disclosurePanelId}
            aria-label="Mobile question navigation"
            hidden={!mobileOpen}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeMobileNavigation();
              }
            }}
            className="border-t border-brand-border px-5 py-5"
          >
            {mobileOpen && (
              <>
                <QuestionNavigator
                  totalQuestions={totalQuestions}
                  currentQuestionIndex={currentQuestionIndex}
                  questionStates={questionStates}
                  flaggedQuestionIndices={flaggedQuestionIndices}
                  disabled={navigationDisabled}
                  showHeader={false}
                  onNavigate={(index) => {
                    if (!navigationDisabled && onNavigate(index) !== false) {
                      closeMobileNavigation();
                    }
                  }}
                />
                {finishSection}
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <aside
      aria-label="Question navigation sidebar"
      className="hidden min-w-0 rounded-2xl border border-brand-border bg-white p-7 text-brand-text shadow-xs md:block xl:w-85"
    >
      <QuestionNavigator
        totalQuestions={totalQuestions}
        currentQuestionIndex={currentQuestionIndex}
        questionStates={questionStates}
        flaggedQuestionIndices={flaggedQuestionIndices}
        disabled={navigationDisabled}
        onNavigate={onNavigate}
      />
      {finishSection}
    </aside>
  );
}
