interface BadgeProps {
  questionNumber: number | string;
  questionType: string;
}

export default function Badge({ questionNumber, questionType }: BadgeProps) {
  // Format question number to always be two digits
  const formattedNumber = String(questionNumber).padStart(2, "0");

  return (
    <div>
      <p className="uppercase text-gray-700 font-bold text-sm">
        Question {formattedNumber} / {questionType}
      </p>
    </div>
  );
}
