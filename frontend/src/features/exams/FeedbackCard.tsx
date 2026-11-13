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
      ? "border-[#9fcfad] bg-[#e7f5ea] text-[#225c38]"
      : "border-[#e8abb2] bg-[#fff0f1] text-[#933443]"
    : "border-[#d4dadd] bg-[#f7f8f9] text-[#56616a]";

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
      className={`mt-5 rounded-md border p-4 text-sm ${containerStyle}`}
    >
      <p className="font-semibold">{headingText}</p>
      {feedback?.explanation ? (
        <p className="mt-2 leading-5">
          <span className="font-semibold">Explanation:</span>{" "}
          {feedback.explanation}
        </p>
      ) : (
        <p className="mt-2 leading-5">
          {isShortAnswer
            ? "Short answers are not automatically graded."
            : "Your submitted answer is locked for this attempt."}
        </p>
      )}
    </div>
  );
}
