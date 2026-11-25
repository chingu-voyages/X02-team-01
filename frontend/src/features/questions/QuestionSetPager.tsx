import { ChevronLeft, ChevronRight } from "lucide-react";

interface QuestionSetPagerProps {
  startIndex: number;
  endIndex: number;
  totalQuestions: number;
  canPrevious: boolean;
  canNext: boolean;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export default function QuestionSetPager({
  startIndex,
  endIndex,
  totalQuestions,
  canPrevious,
  canNext,
  disabled = false,
  onPrevious,
  onNext,
}: QuestionSetPagerProps) {
  if (totalQuestions <= 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        aria-label="Previous question set"
        disabled={disabled || !canPrevious}
        onClick={onPrevious}
        className="flex h-12.25 w-12 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-brand-primary bg-white text-brand-primary transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:border-brand-secondary disabled:text-brand-secondary disabled:hover:bg-white"
      >
        <ChevronLeft aria-hidden="true" className="size-4 stroke-[2.25]" />
      </button>

      <span
        aria-live="polite"
        className="text-xs font-semibold tracking-tight text-brand-text/75"
      >
        {startIndex + 1}-{endIndex} of {totalQuestions}
      </span>

      <button
        type="button"
        aria-label="Next question set"
        disabled={disabled || !canNext}
        onClick={onNext}
        className="flex h-12.25 w-12 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-brand-primary bg-white text-brand-primary transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:border-brand-secondary disabled:text-brand-secondary disabled:hover:bg-white"
      >
        <ChevronRight aria-hidden="true" className="size-4 stroke-[2.25]" />
      </button>
    </div>
  );
}