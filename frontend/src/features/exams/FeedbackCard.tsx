import type { FeedbackEntry } from "@/types/exam-api.types";

interface FeedbackCardProps {
  isShortAnswer: boolean;
  feedback?: FeedbackEntry;
}

export default function FeedbackCard({
  isShortAnswer,
  feedback,
}: FeedbackCardProps) {
  const hasBooleanVerdict = typeof feedback?.is_correct === "boolean";

  const containerStyle = hasBooleanVerdict
    ? feedback?.is_correct
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : "border-red-300 bg-red-50 text-red-950"
    : "border-brand-border bg-brand-surface text-brand-text";

  const headingText = isShortAnswer
    ? "Answer recorded."
    : typeof feedback?.is_correct === "boolean"
      ? feedback.is_correct
        ? "Correct answer."
        : "Incorrect answer."
      : "Answer submitted.";

  return (
    <div
      role="status"
      className={`mt-5 rounded-xl border p-4 text-sm ${containerStyle}`}
    >
      <p className="font-semibold">{headingText}</p>
      {feedback?.explanation ? (
        <p className="mt-2 leading-5">
          <span className="font-semibold">Explanation:</span>{" "}
          {feedback.explanation}
        </p>
      ) : (
        <p className="mt-2 leading-5 opacity-80">
          {isShortAnswer
            ? "Short answers are not automatically graded."
            : "Your submitted answer is locked for this attempt."}
        </p>
      )}
    </div>
  );
}