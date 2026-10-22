interface ExamCardHeaderProps {
  currentQuestionIndex: number;
  totalQuestions: number;
  isMultiple: boolean;
  category: string;
}

export default function ExamCardHeader({
  currentQuestionIndex,
  totalQuestions,
  isMultiple,
  category
}: ExamCardHeaderProps) {
  const instructionText = isMultiple
    ? "Choose all that apply, then submit."
    : "Choose one answer, then submit.";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl">
          {category} <span className="font-normal">· In progress</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Question {currentQuestionIndex + 1} of {totalQuestions} ·{" "}
          {instructionText}.
        </p>
      </div>
    </div>
  );
}
