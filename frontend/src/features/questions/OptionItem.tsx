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

  return (
    <label
      onClick={!isSubmitted ? onSelect : undefined}
      className={isSubmitted ? "cursor-not-allowed" : ""}
    >
      <div
        className={`
          flex gap-2 items-center  border  p-3 rounded-sm ${
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
          <RadioGroupItem value={id} disabled={isSubmitted} />
        ) : (
          <Checkbox disabled={isSubmitted} />
        )}
        {option}
      </div>
    </label>
  );
}
