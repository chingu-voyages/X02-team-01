import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroupItem } from "@/components/ui/radio-group";

interface OptionItemProps {
  questionType: "single" | "multiple";
  option: string;
  id: string;
  isSelected: boolean;
  onSelect: () => void;
  isSubmitted: boolean;
  correctOptionIds: string[];
}

export default function OptionItem({
  questionType,
  id,
  option,
  isSelected,
  onSelect,
  isSubmitted,
  correctOptionIds,
}: OptionItemProps) {
  const isCorrectOption = correctOptionIds.includes(id);
  const isIncorrectSelection = isSubmitted && isSelected && !isCorrectOption;

  const getFeedbackBadge = () => {
    if (!isSubmitted) return null;

    // Option was selected and is correct
    if (isSelected && isCorrectOption) {
      return (
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-green-800 bg-green-100 px-2 py-0.5 rounded">
          <span aria-hidden="true">✓</span>
          <span>Correct</span>
        </span>
      );
    }

    // Missed correct answer
    if (!isSelected && isCorrectOption) {
      return (
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-blue-800 bg-blue-100 px-2 py-0.5 rounded">
          <span aria-hidden="true">✓</span>
          <span>Correct Answer</span>
        </span>
      );
    }

    return null;
  };

  return (
    <div
      onClick={() => {
        if (!isSubmitted) onSelect();
      }}
      className={`flex min-h-11 gap-3 items-center border p-3 rounded-sm ${
        isSubmitted
          ? isCorrectOption
            ? "border-green-500 bg-green-50 text-green-900 cursor-not-allowed"
            : isIncorrectSelection
              ? "border-red-500 bg-red-50 text-red-900 cursor-not-allowed"
              : isSelected
                ? "border-black bg-gray-300 cursor-not-allowed"
                : "border-gray-300 bg-white cursor-not-allowed"
          : isSelected
            ? "border-black bg-gray-300 cursor-pointer"
            : "border-gray-300 bg-white hover:bg-gray-200 hover:border-gray-500 transition-colors duration-300 cursor-pointer"
      }`}
    >
      {questionType === "single" ? (
        <RadioGroupItem
          value={id}
          id={id}
          disabled={isSubmitted}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Checkbox
          id={id}
          checked={isSelected}
          onCheckedChange={!isSubmitted ? onSelect : undefined}
          disabled={isSubmitted}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="flex items-center justify-between w-full">
        <span>{option}</span>
        {getFeedbackBadge()}
      </div>
    </div>
  );
}
