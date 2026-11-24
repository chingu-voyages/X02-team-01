import { Check, Flag, Minus, Pencil } from "lucide-react";
import { useId, type Ref } from "react";
import type {
  QuestionResponseState,
  QuestionState,
} from "@/lib/question-states";

interface QuestionNavigatorProps {
  totalQuestions: number;
  currentQuestionIndex: number;
  questionStates?: readonly QuestionState[];
  flaggedQuestionIndices?: readonly number[];
  disabled?: boolean;
  showHeading?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
  onNavigate: (index: number) => void;
}

const responsePresentation = {
  unanswered: {
    label: "Unanswered",
    Icon: Minus,
    buttonClass:
      "border-[#cbd0d3] bg-white text-[#303639] hover:bg-[#f3f4f5]",
    iconClass: "text-[#56616a]",
  },
  unsubmitted: {
    label: "Selected but unsubmitted",
    Icon: Pencil,
    buttonClass:
      "border-amber-300 bg-amber-50 text-[#303639] hover:bg-amber-100",
    iconClass: "text-amber-800",
  },
  submitted: {
    label: "Submitted",
    Icon: Check,
    buttonClass:
      "border-green-300 bg-green-50 text-[#303639] hover:bg-green-100",
    iconClass: "text-green-800",
  },
} satisfies Record<
  QuestionResponseState,
  {
    label: string;
    Icon: typeof Check;
    buttonClass: string;
    iconClass: string;
  }
>;

const responseStates: QuestionResponseState[] = [
  "unanswered",
  "unsubmitted",
  "submitted",
];

export default function QuestionNavigator({
  totalQuestions,
  currentQuestionIndex,
  questionStates,
  flaggedQuestionIndices = [],
  disabled = false,
  showHeading = true,
  scrollRef,
  onNavigate,
}: QuestionNavigatorProps) {
  const legendId = useId();
  const flagged = new Set(flaggedQuestionIndices);

  const hasQuestionStates = questionStates !== undefined;
  const questionCount = questionStates?.length ?? totalQuestions;

  const submittedCount =
    questionStates?.filter(
      (question) => question.responseState === "submitted",
    ).length ?? 0;

  const remainingCount = questionCount - submittedCount;

  const progressPercent =
    questionCount > 0
      ? (submittedCount / questionCount) * 100
      : 0;

  return (
    <nav aria-label="Question navigation">
      {showHeading && (
        <h3 className="mb-3 text-sm font-bold">
          Question Navigation
        </h3>
      )}

      {hasQuestionStates && (
        <div className="mb-4 space-y-3">
          <div
            aria-live="polite"
            aria-atomic="true"
            className="grid grid-cols-3 gap-2 text-center"
          >
            <div className="rounded-md border border-[#e2e5e7] bg-[#f7f8f9] p-2">
              <span className="block text-lg font-bold text-[#303639]">
                {questionCount}
              </span>
              <span className="text-xs text-[#56616a]">
                Total
              </span>
            </div>

            <div className="rounded-md border border-[#e2e5e7] bg-[#f7f8f9] p-2">
              <span className="block text-lg font-bold text-[#303639]">
                {submittedCount}
              </span>
              <span className="text-xs text-[#56616a]">
                Submitted
              </span>
            </div>

            <div className="rounded-md border border-[#e2e5e7] bg-[#f7f8f9] p-2">
              <span className="block text-lg font-bold text-[#303639]">
                {remainingCount}
              </span>
              <span className="text-xs text-[#56616a]">
                Remaining
              </span>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Exam submission progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            aria-valuetext={`${submittedCount} of ${questionCount} questions submitted`}
            className="h-2 overflow-hidden rounded-full bg-[#e2e5e7]"
          >
            <div
              className="h-full rounded-full bg-[#343a3e] transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-80 overflow-y-auto overscroll-contain p-1"
      >
        <ol className="grid grid-cols-5 gap-2">
          {Array.from({ length: questionCount }, (_, index) => {
            const state = questionStates?.[index];

            const isCurrent =
              state?.isCurrent ?? index === currentQuestionIndex;

            const isFlagged =
              state?.isFlagged ?? flagged.has(index);

            const presentation = state
              ? responsePresentation[state.responseState]
              : undefined;

            const ResponseIcon = presentation?.Icon;

            return (
              <li
                key={state?.questionId ?? index}
                className="min-w-0"
              >
                <button
                  type="button"
                  aria-label={`Question ${index + 1}${
                    isFlagged ? ", flagged for review" : ""
                  }`}
                  aria-describedby={
                    state
                      ? `${legendId}-${state.responseState}`
                      : undefined
                  }
                  aria-current={isCurrent ? "step" : undefined}
                  disabled={disabled}
                  onClick={() => onNavigate(index)}
                  className={`relative flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e] disabled:cursor-not-allowed disabled:opacity-50 ${
                    presentation?.buttonClass ??
                    "border-[#cbd0d3] bg-white text-[#303639] hover:bg-[#f3f4f5]"
                  } ${
                    isCurrent
                      ? "ring-2 ring-inset ring-[#343a3e]"
                      : ""
                  }`}
                >
                  <span>{index + 1}</span>

                  {(ResponseIcon || isFlagged) && (
                    <span className="flex items-center justify-center gap-1">
                      {ResponseIcon && (
                        <ResponseIcon
                          aria-hidden="true"
                          className={`size-3.5 ${presentation?.iconClass}`}
                        />
                      )}

                      {isFlagged && (
                        <Flag
                          aria-hidden="true"
                          className="size-3.5 text-[#8a5a0a]"
                          fill="currentColor"
                        />
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {hasQuestionStates ? (
        <section
          aria-label="Question state legend"
          className="mt-4 border-t border-[#e2e5e7] pt-3"
        >
          <h4 className="mb-2 text-xs font-bold text-[#303639]">
            Question states
          </h4>

          <ul className="space-y-2 text-xs text-[#56616a]">
            {responseStates.map((state) => {
              const { label, Icon, iconClass } =
                responsePresentation[state];

              return (
                <li
                  key={state}
                  className="flex items-center gap-2"
                >
                  <Icon
                    aria-hidden="true"
                    className={`size-4 shrink-0 ${iconClass}`}
                  />

                  <span id={`${legendId}-${state}`}>
                    {label}
                  </span>
                </li>
              );
            })}

            <li className="flex items-center gap-2">
              <Flag
                aria-hidden="true"
                className="size-4 shrink-0 text-[#8a5a0a]"
                fill="currentColor"
              />
              <span>Flagged for review</span>
            </li>

            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-sm border-2 border-[#343a3e]"
              />
              <span>Current question</span>
            </li>
          </ul>
        </section>
      ) : (
        flaggedQuestionIndices.length > 0 && (
          <p className="mt-2 flex items-center gap-2 text-xs text-[#56616a]">
            <Flag
              aria-hidden="true"
              className="size-3.5 text-[#8a5a0a]"
              fill="currentColor"
            />
            Flagged for review
          </p>
        )
      )}
    </nav>
  );
}