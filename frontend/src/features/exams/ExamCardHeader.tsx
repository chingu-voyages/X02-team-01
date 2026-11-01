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
  category,
}: ExamCardHeaderProps) {
  const instructionText = isMultiple
    ? "Choose all that apply, then submit."
    : "Choose one answer, then submit.";

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-2xl">
          {category}{" "}
          <span aria-hidden="true" className="font-normal">
            · In progress
          </span>
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">
          Question {currentQuestionIndex + 1} of {totalQuestions}{" "}
          <span aria-hidden="true">·</span> {instructionText}
        </p>
      </div>
    </div>
  );
}
