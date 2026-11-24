interface QuestionNavigatorProps {
  totalQuestions: number;
  currentQuestionIndex: number;
  disabled?: boolean;
  onNavigate: (index: number) => void;
}

export default function QuestionNavigator({
  totalQuestions,
  currentQuestionIndex,
  disabled = false,
  onNavigate,
}: QuestionNavigatorProps) {
  return (
    <nav aria-label="Question navigation">
      <h3 className="mb-3 text-sm font-bold">Question Navigation</h3>
      <div className="max-h-80 overflow-y-auto p-1">
        <ol className="grid grid-cols-5 gap-2">
          {Array.from({ length: totalQuestions }, (_, index) => {
            const isCurrent = index === currentQuestionIndex;

            return (
              <li key={index} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Question ${index + 1}`}
                  aria-current={isCurrent ? "step" : undefined}
                  disabled={disabled}
                  onClick={() => onNavigate(index)}
                  className={`flex min-h-11 w-full items-center justify-center rounded-md border px-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isCurrent
                      ? "border-[#343a3e] bg-[#343a3e] text-white"
                      : "border-[#cbd0d3] bg-white text-[#303639] hover:bg-[#f3f4f5]"
                  }`}
                >
                  {index + 1}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
