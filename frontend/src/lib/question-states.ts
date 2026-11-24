import type { ExamQuestionWithResponse } from "@/types/exam-api.types";

export type QuestionResponseState =
  | "unanswered"
  | "unsubmitted"
  | "submitted";

export interface QuestionState {
  questionId: string;
  responseState: QuestionResponseState;
  isFlagged: boolean;
  isCurrent: boolean;
}

type AttemptQuestion = Pick<
  ExamQuestionWithResponse,
  "id" | "question_type" | "flagged_for_review"
>;

interface QuestionStateInput {
  questions: readonly AttemptQuestion[];
  currentQuestionIndex: number;
  submittedMap: Readonly<Record<string, boolean>>;
  selectedValuesMap: Readonly<Record<string, readonly string[]>>;
  textAnswersMap: Readonly<Record<string, string>>;
}

export function deriveQuestionStates({
  questions,
  currentQuestionIndex,
  submittedMap,
  selectedValuesMap,
  textAnswersMap,
}: QuestionStateInput) {
  const questionStates: QuestionState[] = questions.map(
    (question, index) => {
      const isSubmitted = submittedMap[question.id] === true;

      const hasDraft =
        question.question_type === "short_answer"
          ? Boolean(textAnswersMap[question.id]?.trim())
          : (selectedValuesMap[question.id]?.length ?? 0) > 0;

      const responseState: QuestionResponseState = isSubmitted
        ? "submitted"
        : hasDraft
          ? "unsubmitted"
          : "unanswered";

      return {
        questionId: question.id,
        responseState,
        isFlagged: question.flagged_for_review === true,
        isCurrent: index === currentQuestionIndex,
      };
    },
  );

  const totalQuestions = questionStates.length;

  const submittedCount = questionStates.filter(
    (question) => question.responseState === "submitted",
  ).length;

  const remainingCount = totalQuestions - submittedCount;

  const firstUnsubmittedIndex = questionStates.findIndex(
    (question) => question.responseState !== "submitted",
  );

  return {
    questionStates,
    totalQuestions,
    submittedCount,
    remainingCount,
    firstUnsubmittedIndex,
    allQuestionsSubmitted:
      totalQuestions > 0 && remainingCount === 0,
  };
}