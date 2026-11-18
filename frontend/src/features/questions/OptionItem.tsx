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
    ? "border-[#9fcfad] bg-[#e7f5ea] text-[#225c38]"
    : isIncorrectSelection
      ? "border-[#e8abb2] bg-[#fff0f1] text-[#933443]"
      : isSelected
        ? "border-[#adb7bd] bg-[#edf1f3] text-[#303639]"
        : "border-[#d4dadd] bg-white text-[#303639]";

  return (
    <div
      onClick={() => {
        if (!isLocked) onSelect();
      }}
      className={`flex min-h-12 items-center gap-3 rounded-md border px-4 py-3 text-sm transition-colors ${appearance} ${
        isLocked
          ? "cursor-default"
          : "cursor-pointer hover:border-[#89959c] hover:bg-[#f4f6f7]"
      }`}
    >
      {questionType === "single" ? (
        <RadioGroupItem
          value={id}
          id={id}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <Checkbox
          id={id}
          checked={isSelected}
          onCheckedChange={!isLocked ? onSelect : undefined}
          disabled={isLocked}
          onClick={(event) => event.stopPropagation()}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span className="leading-5">
          {choiceLabel && <span className="mr-2 font-semibold">{choiceLabel}.</span>}
          {option}
        </span>

        {isCorrectOption && (
          <span className="rounded bg-[#d7ebdc] px-2 py-1 text-xs font-semibold text-[#225c38]">
            ✓ Correct answer
          </span>
        )}
        {isIncorrectSelection && (
          <span className="rounded bg-[#f8dfe2] px-2 py-1 text-xs font-semibold text-[#933443]">
            × Your answer
          </span>
        )}
      </div>
    </div>
  );
}
