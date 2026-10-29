interface BadgeProps {
  questionNumber: number | string;
  questionType: string;
}

// Format question type for accessibility
const questionTypeLabels: Record<string, string> = {
  multiple_choice: "Multiple Choice",
  short_answer: "Short Answer",
};

export default function Badge({ questionNumber, questionType }: BadgeProps) {
  // Format question number to always be two digits
  const formattedNumber = String(questionNumber).padStart(2, "0");
  const readableType =
    questionTypeLabels[questionType] || questionType.replace(/_/g, " ");

  return (
    <p className="uppercase text-gray-700 font-bold text-xs">
      Question {formattedNumber} / {readableType}
    </p>
  );
}
