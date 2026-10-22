import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroupItem } from "@/components/ui/radio-group";

interface OptionItemProps {
  questionType: "single" | "multiple";
  option: string;
  isSelected: boolean;
  onSelect: () => void;
}

export default function OptionItem({
  questionType,
  option,
  isSelected,
  onSelect,
}: OptionItemProps) {
  return (
    <label onClick={onSelect}>
      <div
        className={`
          flex gap-2 items-center  border  p-3 rounded-sm ${
            isSelected
              ? `border-black bg-gray-300`
              : `border-gray-300 bg-white hover:cursor-pointer hover:bg-gray-200 hover:border-gray-500 transition-colors duration-300`
          }`}
      >
        {questionType === "single" ? (
          <RadioGroupItem value={option} />
        ) : (
          <Checkbox />
        )}
        {option}
      </div>
    </label>
  );
}
