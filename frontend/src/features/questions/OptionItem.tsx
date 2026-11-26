import { Check, X } from "lucide-react";

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
  const isMutedLocked =
    isLocked && !isSelected && !isCorrectOption && !isIncorrectSelection;

  const choiceLabel =
    position && position >= 1 && position <= 26
      ? String.fromCharCode(64 + position)
      : null;

  const appearance = isCorrectOption
    ? "border-2 border-emerald-700 bg-emerald-50/75 text-brand-text"
    : isIncorrectSelection
      ? "border-2 border-red-700 bg-red-50/75 text-brand-text"
      : isSelected
        ? "border-2 border-brand-primary bg-brand-surface text-brand-text"
        : isMutedLocked
          ? "border border-brand-border/80 bg-white text-brand-text/45"
          : "border border-brand-border bg-white text-brand-text";

  const letterBadgeAppearance = isCorrectOption
    ? "bg-emerald-800 text-white"
    : isIncorrectSelection
      ? "bg-red-700 text-white"
      : isSelected
        ? "bg-brand-primary text-white"
        : isMutedLocked
          ? "bg-brand-surface/70 text-brand-primary/40"
          : "bg-brand-surface text-brand-primary";

  const showVerdictIcon = isCorrectOption || isIncorrectSelection;

  const selectionControl =
    questionType === "single" ? (
      <RadioGroupItem
        value={id}
        id={id}
        disabled={isLocked}
        onClick={(event) => event.stopPropagation()}
        className={
          showVerdictIcon
            ? "sr-only"
            : `size-4.5 border-brand-secondary text-brand-primary focus-visible:ring-0 focus-visible:outline-none data-[state=checked]:border-brand-primary ${
                isMutedLocked ? "opacity-50" : ""
              }`
        }
      />
    ) : (
      <Checkbox
        id={id}
        checked={isSelected}
        onCheckedChange={!isLocked ? onSelect : undefined}
        disabled={isLocked}
        onClick={(event) => event.stopPropagation()}
        className={
          showVerdictIcon
            ? "sr-only"
            : `size-4.5 border-brand-secondary focus-visible:ring-0 focus-visible:outline-none data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary data-[state=checked]:text-white ${
                isMutedLocked ? "opacity-50" : ""
              }`
        }
      />
    );

  return (
    <div
      onClick={() => {
        if (!isLocked) onSelect();
      }}
      className={`flex min-h-13 items-center gap-3.5 rounded-xl px-4 py-3.5 text-sm transition-colors ${appearance} ${
        isLocked
          ? "cursor-default"
          : "cursor-pointer hover:border-brand-primary/60 hover:bg-brand-surface has-focus-visible:border-brand-primary-dark has-focus-visible:ring-2 has-focus-visible:ring-brand-primary-dark"
      }`}
    >
      {selectionControl}

      {isCorrectOption && (
        <span
          aria-hidden="true"
          className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-emerald-700 text-emerald-700"
        >
          <Check className="size-3 stroke-[2.75]" />
        </span>
      )}

      {isIncorrectSelection && (
        <span
          aria-hidden="true"
          className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-red-700 text-red-700"
        >
          <X className="size-3 stroke-[2.75]" />
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span
          className={`flex min-w-0 items-center gap-3 leading-5 ${
            isSelected || isCorrectOption || isIncorrectSelection
              ? "font-semibold"
              : "font-normal"
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
          <span className="text-xs font-bold text-emerald-800">Correct</span>
        ) : isIncorrectSelection ? (
          <span className="text-xs font-bold text-red-700">Incorrect</span>
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