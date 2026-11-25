import { Check } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroupItem } from "@/components/ui/radio-group";

interface OptionItemProps {
  questionType: "single" | "multiple";
  option: string;
  id: string;
  position?: number;
  isSelected: boolean;
  onSelect: () => void;
  isSubmitted: boolean;
  feedbackReleased: boolean;
  correctOptionIds: string[];
  disabled?: boolean;
}

export default function OptionItem({
  questionType,
  option,
  id,
  position,
  isSelected,
  onSelect,
  isSubmitted,
  feedbackReleased,
  correctOptionIds,
  disabled = false,
}: OptionItemProps) {
  // Never infer correctness when the backend withheld its feedback.
  const isCorrectOption =
    isSubmitted && feedbackReleased && correctOptionIds.includes(id);
  const isIncorrectSelection =
    isSubmitted && feedbackReleased && isSelected && !isCorrectOption;
  const isLocked = isSubmitted || disabled;
  const choiceLabel =
    position && position >= 1 && position <= 26
      ? String.fromCharCode(64 + position)
      : null;

  const appearance = isCorrectOption
    ? "border border-emerald-300 bg-emerald-50 text-emerald-950"
    : isIncorrectSelection
      ? "border border-red-300 bg-red-50 text-red-950"
      : isSelected
        ? "border-2 border-brand-primary bg-brand-surface text-brand-text"
        : "border border-brand-border bg-white text-brand-text";

  const letterBadgeAppearance = isCorrectOption
    ? "bg-emerald-600 text-white"
    : isIncorrectSelection
      ? "bg-red-600 text-white"
      : isSelected
        ? "bg-brand-primary text-white"
        : "bg-brand-surface text-brand-primary";

  return (
    <div
      onClick={() => {
        if (!isLocked) onSelect();
      }}
      className={`flex min-h-13 items-center gap-3.5 rounded-xl px-4 py-3.5 text-sm transition-colors ${appearance} ${
        isLocked
          ? "cursor-default"
          : "cursor-pointer hover:border-brand-primary/60 hover:bg-brand-surface/70"
      }`}
    >
      {questionType === "single" ? (
        <RadioGroupItem
          value={id}
          id={id}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
          className="border-brand-secondary text-brand-primary data-[state=checked]:border-brand-primary"
        />
      ) : (
        <Checkbox
          id={id}
          checked={isSelected}
          onCheckedChange={!isLocked ? onSelect : undefined}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
          className="border-brand-secondary data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary data-[state=checked]:text-white"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span
          className={`flex min-w-0 items-center gap-3 leading-5 ${
            isSelected ? "font-semibold" : "font-normal"
          }`}
        >
          {choiceLabel && (
            <span
              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors ${letterBadgeAppearance}`}
            >
              {choiceLabel}
            </span>
          )}
          <span>{option}</span>
        </span>

        {isCorrectOption ? (
          <span className="rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            ✓ Correct answer
          </span>
        ) : isIncorrectSelection ? (
          <span className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
            × Your answer
          </span>
        ) : (
          isSelected && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary">
              <Check aria-hidden="true" className="size-3.5 stroke-[2.5]" />
              Selected
            </span>
          )
        )}
      </div>
    </div>
  );
}