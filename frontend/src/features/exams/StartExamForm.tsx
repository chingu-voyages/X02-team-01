"use client";

import type { FormEvent } from "react";
import type { PracticeCategory } from "@/types/category-api.types";

type StartExamFormProps = {
  category: PracticeCategory;
  questionCount: number;
  isStarting: boolean;
  startError: string;
  existingAttemptId: string | null;
  onQuestionCountChange: (count: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onContinueExisting: () => void;
};

export default function StartExamForm({
  category,
  questionCount,
  isStarting,
  startError,
  existingAttemptId,
  onQuestionCountChange,
  onSubmit,
  onContinueExisting,
}: StartExamFormProps) {
  const maxQuestions = Math.min(category.available_question_count, 100);

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs"
    >
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-brand-text/65">
          Selected practice exam
        </p>

        <h2 className="text-xl font-bold">Start {category.name}</h2>

        <p className="mt-1 text-sm text-brand-text/70">
          {category.certification_name}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="question-count" className="block text-sm font-semibold">
          Number of questions
        </label>

        <input
          id="question-count"
          type="number"
          min={1}
          max={maxQuestions}
          value={questionCount}
          onChange={(event) =>
            onQuestionCountChange(Number(event.target.value))
          }
          className="w-36 rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2.5 text-sm text-brand-text"
          required
        />
      </div>

      {startError && (
        <p role="alert" className="text-sm text-red-700">
          {startError}
        </p>
      )}

      {existingAttemptId && (
        <div className="rounded-md border border-brand-border bg-brand-surface p-4">
          <p className="mb-3 text-sm text-brand-text/80">
            Continue your existing attempt instead of starting another exam.
          </p>

          <button
            type="button"
            onClick={onContinueExisting}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-5 py-2.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-secondary/30"
          >
            Continue existing exam
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={isStarting}
        className="cursor-pointer rounded-md bg-brand-accent px-6 py-2.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isStarting ? "Starting exam..." : "Start Exam"}
      </button>
    </form>
  );
}