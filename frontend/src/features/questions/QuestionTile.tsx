import { Check, Flag } from "lucide-react";

export interface QuestionTileProps {
  questionNumber: number;
  isCurrent: boolean;
  isAnswered: boolean;
  isFlagged: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export default function QuestionTile({
  questionNumber,
  isCurrent,
  isAnswered,
  isFlagged,
  disabled = false,
  onSelect,
}: QuestionTileProps) {
  const labelParts = [
    `Question ${questionNumber}`,
    isAnswered ? "answered" : "unanswered",
    ...(isFlagged ? ["flagged"] : []),
  ];

  const stateClasses = isCurrent
    ? "border-[1.5px] border-brand-primary bg-brand-primary text-white ring-[3px] ring-brand-accent-tint"
    : isAnswered && isFlagged
      ? "border-[1.5px] border-dashed border-brand-primary bg-brand-secondary/75 text-brand-text hover:bg-brand-secondary"
      : isAnswered
        ? "border-[1.5px] border-transparent bg-brand-secondary/75 text-brand-primary-dark hover:border-brand-primary/50"
        : isFlagged
          ? "border-[1.5px] border-dashed border-brand-primary bg-white text-brand-primary hover:bg-brand-surface"
          : "border-[1.5px] border-brand-secondary bg-white text-brand-text hover:border-brand-primary";

  return (
    <button
      type="button"
      aria-label={labelParts.join(", ")}
      aria-current={isCurrent ? "step" : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-12.25 w-12 cursor-pointer items-start justify-between rounded-lg px-2 py-1.75 text-xs font-bold leading-none transition-colors focus-visible:border-2 focus-visible:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${stateClasses}`}
    >
      <span>{questionNumber}</span>

      {!isCurrent && isFlagged && (
        <Flag
          aria-hidden="true"
          className="size-3.75 shrink-0 text-brand-primary"
        />
      )}

      {!isCurrent && !isFlagged && isAnswered && (
        <Check
          aria-hidden="true"
          className="size-3.75 shrink-0 stroke-[2.25] text-brand-primary-dark"
        />
      )}
    </button>
  );
}
