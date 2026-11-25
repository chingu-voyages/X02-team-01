"use client";

import { Flag } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import PageHeader from "@/components/layouts/PageHeader";
import { Button } from "@/components/ui/button";

interface ExamHeaderProps {
  categoryTitle?: string;
  examLabel?: string;
  questionIndex: number;
  totalQuestions: number;
  submittedCount: number;
  isFlagged?: boolean;
  isSavingFlag?: boolean;
  canToggleFlag?: boolean;
  disabled?: boolean;
  flagError?: string;
  onToggleFlag?: () => void;
}

export default function ExamHeader({
  categoryTitle,
  examLabel = "Practice Exam",
  questionIndex,
  totalQuestions,
  submittedCount,
  isFlagged = false,
  isSavingFlag = false,
  canToggleFlag = false,
  disabled = false,
  flagError = "",
  onToggleFlag,
}: ExamHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedRef = useRef(false);
  const flagStatusId = useId();
  const flagErrorId = useId();
  const progressLabelId = useId();

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    headingRef.current?.focus();
  }, [questionIndex]);

  const progressPercent =
    totalQuestions > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((submittedCount / totalQuestions) * 100)),
        )
      : 0;

  const trimmedCategory = categoryTitle?.trim();
  const stepLabel =
    trimmedCategory &&
    trimmedCategory.toLowerCase() !== examLabel.toLowerCase()
      ? `${trimmedCategory} · ${examLabel}`
      : examLabel;

  const title = (
    <>
      <span>Question {questionIndex + 1}</span>{" "}
      <span className="font-medium text-brand-text/60">
        of {totalQuestions}
      </span>
    </>
  );

  const flagAction = onToggleFlag ? (
    <div className="flex flex-col gap-1 md:items-end">
      <Button
        type="button"
        variant="outline"
        aria-pressed={isFlagged}
        onClick={onToggleFlag}
        disabled={!canToggleFlag || isSavingFlag || disabled}
        aria-describedby={
          flagError ? `${flagStatusId} ${flagErrorId}` : flagStatusId
        }
        className={`min-h-11 w-full cursor-pointer rounded-xl border-2 px-4 text-sm font-semibold text-brand-text shadow-xs transition-colors md:w-auto ${
          isFlagged
            ? "border-brand-accent bg-brand-accent/25 hover:bg-brand-accent/35"
            : "border-brand-accent bg-brand-accent-tint hover:bg-brand-accent/25"
        }`}
      >
        <Flag
          aria-hidden="true"
          className="size-4 text-brand-primary"
          fill={isFlagged ? "currentColor" : "none"}
        />
        {isFlagged ? "Flagged for Review" : "Flag for Review"}
      </Button>

      <span id={flagStatusId} role="status" className="sr-only">
        {isSavingFlag
          ? "Saving review flag..."
          : isFlagged
            ? "Flagged for review"
            : "Not flagged"}
      </span>

      {flagError && (
        <p id={flagErrorId} role="alert" className="text-xs text-red-700">
          {flagError}
        </p>
      )}
    </div>
  ) : undefined;

  return (
    <div className="my-6 space-y-4">
      <PageHeader
        stepLabel={stepLabel}
        title={title}
        headingRef={headingRef}
        action={flagAction}
      />

      <div className="space-y-2">
        <div
          role="progressbar"
          aria-labelledby={progressLabelId}
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="relative h-2.5 w-full rounded-full bg-brand-secondary/55"
        >
          <div
            className="relative h-full rounded-full bg-brand-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          >
            <span
              aria-hidden="true"
              className="absolute right-0 top-1/2 size-4 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-accent shadow-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs font-medium text-brand-text/70">
          <span id={progressLabelId}>Progress</span>
          <span>{progressPercent}%</span>
        </div>
      </div>
    </div>
  );
}