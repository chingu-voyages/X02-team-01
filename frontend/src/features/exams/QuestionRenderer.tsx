import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import FeedbackCard from "./FeedbackCard";
import {
  FeedbackEntry,
  ExamQuestionWithResponse,
} from "@/types/exam-api.types";

interface QuestionRendererProps {
  question: ExamQuestionWithResponse;
  questionIndex: number;
  totalQuestions: number;
  selectedOptionIds: string[];
  textValue: string;
  isSubmitted: boolean;
  isSubmitting: boolean;
  isFinishing: boolean;
  submitError: string;
  feedback?: FeedbackEntry;
  allQuestionsSubmitted: boolean;
  firstUnsubmittedIndex: number;
  onSelectOption: (optionId: string) => void;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReviewUnsubmitted: () => void;
}

export default function QuestionRenderer({
  question,
  questionIndex,
  totalQuestions,
  selectedOptionIds,
  textValue,
  isSubmitted,
  isSubmitting,
  isFinishing,
  submitError,
  feedback,
  allQuestionsSubmitted,
  firstUnsubmittedIndex,
  onSelectOption,
  onTextChange,
  onSubmit,
  onPrevious,
  onNext,
  onReviewUnsubmitted,
}: QuestionRendererProps) {
  const isShortAnswer = question.question_type === "short_answer";
  const isMultiple = question.allows_multiple_answers;
  const isLastQuestion = questionIndex >= totalQuestions - 1;

  const optionFeedbackReleased = Boolean(
    feedback?.feedback_released && feedback.correct_option_ids.length > 0,
  );

  const selectedCount = isShortAnswer
    ? textValue.trim().length
    : selectedOptionIds.length;

  const optionsList = question.options.map((option) => (
    <OptionItem
      key={option.id}
      id={option.id}
      position={option.position}
      option={option.option_text}
      questionType={isMultiple ? "multiple" : "single"}
      isSelected={selectedOptionIds.includes(option.id)}
      onSelect={() => onSelectOption(option.id)}
      isSubmitted={isSubmitted}
      disabled={isSubmitting || isFinishing}
      feedbackReleased={optionFeedbackReleased}
      correctOptionIds={
        optionFeedbackReleased ? feedback!.correct_option_ids : []
      }
    />
  ));

  return (
    <section
      aria-labelledby="question-heading"
      className="min-w-0 rounded-md border border-[#cbd0d3] bg-white p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[#687178]">
        Question {String(questionIndex + 1).padStart(2, "0")} /{" "}
        {isShortAnswer
          ? "Short answer"
          : isMultiple
            ? "Multiple select"
            : "Multiple choice"}
      </p>
      <h2
        id="question-heading"
        className="mb-5 mt-4 text-lg font-bold leading-7 sm:text-xl"
      >
        {question.question_text}
      </h2>

      {isShortAnswer ? (
        <textarea
          aria-label="Your answer"
          value={textValue}
          onChange={(event) => onTextChange(event.target.value)}
          disabled={isSubmitted || isSubmitting || isFinishing}
          placeholder="Type your answer..."
          className="min-h-32 w-full rounded-md border border-[#d4dadd] bg-white p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        />
      ) : isMultiple ? (
        <div
          role="group"
          aria-labelledby="question-heading"
          className="flex flex-col gap-3"
        >
          {optionsList}
        </div>
      ) : (
        <RadioGroup
          value={selectedOptionIds[0] || ""}
          onValueChange={onSelectOption}
          aria-labelledby="question-heading"
          className="flex flex-col gap-3"
        >
          {optionsList}
        </RadioGroup>
      )}

      {isSubmitted && (
        <FeedbackCard isShortAnswer={isShortAnswer} feedback={feedback} />
      )}

      {submitError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onPrevious}
          disabled={questionIndex === 0 || isSubmitting || isFinishing}
          className="h-10 rounded-md border-[#cbd0d3] px-4 text-sm"
        >
          Previous
        </Button>
        {isSubmitted ? (
          isLastQuestion ? (
            allQuestionsSubmitted ? (
              <span className="text-sm text-[#56616a]">
                All answers submitted. Finish the exam in the progress panel.
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={onReviewUnsubmitted}
                disabled={isFinishing || firstUnsubmittedIndex < 0}
                className="h-10 rounded-md border-[#cbd0d3] px-4 text-sm"
              >
                Review unanswered questions
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={onNext}
              disabled={isFinishing}
              className="h-10 rounded-md bg-[#343a3e] px-4 text-sm text-white hover:bg-[#1e2427]"
            >
              Next question
            </Button>
          )
        ) : (
          <Button
            type="button"
            disabled={selectedCount === 0 || isSubmitting || isFinishing}
            onClick={onSubmit}
            className="h-10 rounded-md bg-[#343a3e] px-4 text-sm text-white hover:bg-[#1e2427] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit answer"}
          </Button>
        )}
      </div>
    </section>
  );
}
