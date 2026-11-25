import OptionItem from "@/features/questions/OptionItem";
import { RadioGroup } from "@/components/ui/radio-group";
import FeedbackCard from "./FeedbackCard";
import QuestionMedia from "./QuestionMedia";
import type {
  ExamQuestionWithResponse,
  FeedbackEntry,
} from "@/types/exam-api.types";

interface QuestionRendererProps {
  question: ExamQuestionWithResponse;
  selectedOptionIds: string[];
  textValue: string;
  isSubmitted: boolean;
  isSubmitting: boolean;
  isFinishing: boolean;
  submitError: string;
  feedback?: FeedbackEntry;
  onSelectOption: (optionId: string) => void;
  onTextChange: (value: string) => void;
}

export default function QuestionRenderer({
  question,
  selectedOptionIds,
  textValue,
  isSubmitted,
  isSubmitting,
  isFinishing,
  submitError,
  feedback,
  onSelectOption,
  onTextChange,
}: QuestionRendererProps) {
  const isShortAnswer = question.question_type === "short_answer";
  const isMultiple = question.allows_multiple_answers;

  const optionFeedbackReleased = Boolean(
    feedback?.feedback_released && feedback.correct_option_ids.length > 0,
  );

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
      className="min-w-0 rounded-2xl border border-brand-border bg-white p-6 text-brand-text shadow-xs sm:p-7"
    >
      <h2
        id="question-heading"
        className="mb-5 text-lg font-bold leading-7 text-brand-text sm:text-xl"
      >
        {question.question_text}
      </h2>

      <QuestionMedia images={question.images} />

      {isShortAnswer ? (
        <textarea
          aria-label="Your answer"
          value={textValue}
          onChange={(event) => onTextChange(event.target.value)}
          disabled={isSubmitted || isSubmitting || isFinishing}
          placeholder="Type your answer..."
          className="min-h-32 w-full rounded-xl border border-brand-border bg-white p-3.5 text-sm text-brand-text placeholder:text-brand-text/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:opacity-60"
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
    </section>
  );
}