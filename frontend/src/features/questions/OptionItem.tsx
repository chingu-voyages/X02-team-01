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
    <label
      htmlFor={id}
      className={isSubmitted ? "cursor-not-allowed" : "cursor-pointer"}
    >
      <div
        className={`
          flex gap-2 items-center  border  min-h-11 px-2 rounded-sm ${
            isSubmitted
              ? isCorrectOption
                ? `border-green-500 bg-green-50 text-green-900`
                : isIncorrectSelection
                  ? `border-red-500 bg-red-50 text-red-900`
                  : isSelected
                    ? `border-black bg-gray-300`
                    : `border-gray-300 bg-white`
              : isSelected
                ? `border-black bg-gray-300`
                : `border-gray-300 bg-white hover:cursor-pointer hover:bg-gray-200 hover:border-gray-500 transition-colors duration-300`
          }`}
      >
        {questionType === "single" ? (
          <RadioGroupItem value={id} id={id} disabled={isSubmitted} />
        ) : (
          <Checkbox id={id} disabled={isSubmitted} checked={isSelected} onCheckedChange={!isSubmitted ? () => onSelect : undefined} />
        )}
        <div className="flex items-center justify-between w-full">
          <span>{option}</span>
          {getFeedbackBadge()}
        </div>
      </div>
    </label>
  );
}
