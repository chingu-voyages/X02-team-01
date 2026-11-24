import { Flag } from "lucide-react";
import type { Ref } from "react";

interface QuestionNavigatorProps {
  totalQuestions: number;
  currentQuestionIndex: number;
  flaggedQuestionIndices?: readonly number[];
  disabled?: boolean;
  showHeading?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
  onNavigate: (index: number) => void;
}

export default function QuestionNavigator({
  totalQuestions,
  currentQuestionIndex,
  flaggedQuestionIndices = [],
  disabled = false,
  showHeading = true,
  scrollRef,
  onNavigate,
}: QuestionNavigatorProps) {
  const flagged = new Set(flaggedQuestionIndices);
  return (
    <nav aria-label="Question navigation">
      {showHeading && (
        <h3 className="mb-3 text-sm font-bold">Question Navigation</h3>
      )}
      <div ref={scrollRef} className="max-h-80 overflow-y-auto overscroll-contain p-1">
        <ol className="grid grid-cols-5 gap-2">
          {Array.from({ length: totalQuestions }, (_, index) => {
            const isCurrent = index === currentQuestionIndex;
            const isFlagged = flagged.has(index);

            return (
              <li key={index} className="min-w-0">
                <button
                  type="button"
                  aria-label={`Question ${index + 1}${isFlagged ? ", flagged for review" : ""}`}
                  aria-current={isCurrent ? "step" : undefined}
                  disabled={disabled}
                  onClick={() => onNavigate(index)}
                  className={`relative flex min-h-11 w-full items-center justify-center rounded-md border px-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isCurrent
                      ? "border-[#343a3e] bg-[#343a3e] text-white"
                      : "border-[#cbd0d3] bg-white text-[#303639] hover:bg-[#f3f4f5]"
                  }`}
                >
                  {index + 1}
                  {isFlagged && (
                    <Flag
                      aria-hidden="true"
                      className={`absolute right-0.5 top-0.5 size-3 ${isCurrent ? "text-[#ffd675]" : "text-[#8a5a0a]"}`}
                      fill="currentColor"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {flaggedQuestionIndices.length > 0 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-[#56616a]">
          <Flag aria-hidden="true" className="size-3.5 text-[#8a5a0a]" fill="currentColor" />
          Flagged for review
        </p>
      )}
    </nav>
  );
}
