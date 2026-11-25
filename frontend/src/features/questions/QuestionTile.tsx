import { Flag, Pencil, Send } from "lucide-react";
import { useId } from "react";

export interface QuestionTileProps {
  questionNumber: number;
  isCurrent: boolean;
  isAnswered: boolean;
  isUnsubmitted?: boolean;
  isFlagged: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export default function QuestionTile({
  questionNumber,
  isCurrent,
  isAnswered,
  isUnsubmitted = false,
  isFlagged,
  disabled = false,
  onSelect,
}: QuestionTileProps) {
  const descriptionId = useId();
  const hasDraft = !isAnswered && isUnsubmitted;
  const responseLabel = isAnswered
    ? "Submitted"
    : hasDraft
      ? "Selected but unsubmitted"
      : "Unanswered";

  const stateClasses = isCurrent
    ? "border-[1.5px] border-brand-primary bg-brand-primary text-white ring-[3px] ring-brand-accent-tint"
    : isAnswered
      ? `border-[1.5px] ${isFlagged ? "border-brand-primary" : "border-transparent"} bg-brand-secondary/75 text-brand-primary-dark hover:border-brand-primary/50`
      : hasDraft
        ? "border-[1.5px] border-brand-primary/50 bg-brand-accent-tint text-brand-primary-dark hover:border-brand-primary"
        : isFlagged
          ? "border-[1.5px] border-brand-primary bg-white text-brand-primary hover:bg-brand-surface"
          : "border-[1.5px] border-brand-secondary bg-white text-brand-text hover:border-brand-primary";

  return (
    <button
      type="button"
      aria-label={`Question ${questionNumber}${isFlagged ? ", flagged for review" : ""}`}
      aria-describedby={descriptionId}
      aria-current={isCurrent ? "step" : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-12.25 w-12 cursor-pointer items-start justify-between rounded-lg px-2 py-1.75 text-xs font-bold leading-none transition-colors focus-visible:border-2 focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${stateClasses} ${isFlagged ? "border-dashed" : ""}`}
    >
      <span>{questionNumber}</span>
      <span id={descriptionId} className="sr-only">
        {responseLabel}
      </span>

      {/* Response, review flag and current position are independent cues. */}
      <span aria-hidden="true" className="flex shrink-0 flex-col items-center gap-0.5">
        {isAnswered && <Send className="size-3 stroke-[2.25]" />}
        {hasDraft && <Pencil className="size-3 stroke-[2.25]" />}
        {isFlagged && <Flag className="size-3" />}
      </span>
    </button>
  );
}
