"use client";

import { useId } from "react";
import {
  defaultEssayMaxCharacters,
  validateEssayResponse,
} from "@/lib/essay-response";

export type EssaySubmissionState = "draft" | "submitting" | "submitted";
export type EssayFeedbackState = "pending" | "unavailable";

export interface EssayResponseFieldProps {
  /** Controlled by the attempt's question-version-keyed draft state. */
  value: string;
  onChange: (value: string) => void;
  /** Set submitted only after the server confirms the stored response. */
  submissionState?: EssaySubmissionState;
  feedbackState?: EssayFeedbackState;
  submitError?: string;
  maxCharacters?: number;
  /** For a parent operation such as final exam submission. */
  readOnly?: boolean;
}

/**
 * Presentational essay entry only: no requests, persistence, or grading.
 * The caller owns submission, retries, attempt isolation, and navigation.
 */
export default function EssayResponseField({
  value,
  onChange,
  submissionState = "draft",
  feedbackState = "pending",
  submitError = "",
  maxCharacters = defaultEssayMaxCharacters,
  readOnly = false,
}: EssayResponseFieldProps) {
  const id = useId();
  const inputId = `${id}-essay`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const statusId = `${id}-status`;
  const lengthErrorId = `${id}-length-error`;
  const submitErrorId = `${id}-submit-error`;

  const validation = validateEssayResponse(value, maxCharacters);
  const isSubmitting = submissionState === "submitting";
  const isSubmitted = submissionState === "submitted";
  const isReadOnly = readOnly || isSubmitting || isSubmitted;
  const showLengthError = validation.isOverLimit && !isSubmitted;
  const showSubmitError = submissionState === "draft" && Boolean(submitError);

  const describedBy = [
    hintId,
    countId,
    statusId,
    showLengthError ? lengthErrorId : null,
    showSubmitError ? submitErrorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  const statusText = isSubmitted
    ? feedbackState === "unavailable"
      ? "Answer submitted. Unable to grade."
      : "Answer submitted. Pending feedback."
    : isSubmitting
      ? "Submitting your answer…"
      : "Draft — not submitted.";

  return (
    <div className="min-w-0 space-y-3 text-brand-text">
      <label htmlFor={inputId} className="block text-base font-semibold">
        Your essay response
      </label>

      <p id={hintId} className="text-sm leading-6 text-brand-text/80">
        {isSubmitted
          ? "Your submitted response is read-only. You can still select and copy it."
          : "You can edit your response until you select Submit answer. Submitting locks this answer."}
      </p>

      <textarea
        id={inputId}
        value={value}
        onChange={(event) => {
          if (!isReadOnly) onChange(event.target.value);
        }}
        rows={10}
        wrap="soft"
        spellCheck
        readOnly={isReadOnly}
        aria-busy={isSubmitting}
        aria-invalid={showLengthError}
        aria-describedby={describedBy}
        placeholder="Write your response here. Use paragraphs to organize your ideas."
        className="block min-h-56 w-full min-w-0 resize-y rounded-xl border border-brand-border bg-white p-3.5 text-base leading-7 text-brand-text placeholder:text-brand-text/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary read-only:bg-brand-surface"
      />

      {/* Do not make the counter a live region: announcing every keystroke
          interferes with screen-reader editing. The threshold error is live.
          There is intentionally no maxLength: never silently truncate a paste. */}
      <p id={countId} className="text-sm leading-6 text-brand-text/80">
        {validation.characterCount.toLocaleString("en-US")} /{" "}
        {maxCharacters.toLocaleString("en-US")} characters
      </p>

      {showLengthError && (
        <p id={lengthErrorId} role="alert" className="text-sm leading-6 text-red-700">
          Your response is over the character limit. Shorten it before submitting;
          your text has not been cut off.
        </p>
      )}

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-sm font-medium leading-6"
      >
        {statusText}
      </p>

      {showSubmitError && (
        <p id={submitErrorId} role="alert" className="text-sm leading-6 text-red-700">
          {submitError} Your response is still here. Try submitting again.
        </p>
      )}
    </div>
  );
}
