"use client";

import ExamHeader from "./ExamHeader";
import QuestionRenderer from "./QuestionRenderer";
import { Button } from "@/components/ui/button";
import ExamSidebar from "./ExamSidebar";
import MobileQuestionNavigation from "./MobileQuestionNavigation";
import { useExamAttempt } from "@/hooks/useExamAttempt";

interface ExamCardProps {
  attemptId: string;
}

export default function ExamCard({ attemptId }: ExamCardProps) {
  const {
    ready,
    token,
    questions,
    currentQuestionIndex,
    goToQuestion,
    loadStatus,
    loadError,
    retryLoading,
    currentQuestion,
    currentSelected,
    isSubmitted,
    currentFeedback,
    textValue,
    questionStates,
    submittedCount,
    allQuestionsSubmitted,
    firstUnsubmittedIndex,
    isSubmitting,
    submitError,
    isFinishing,
    finishError,
    isFlagged,
    isSavingFlag,
    flagError,
    canToggleFlag,
    handleToggleFlag,
    handleSelect,
    handleTextChange,
    handleSubmit,
    handleFinish,
  } = useExamAttempt(attemptId);

  if (!ready || !token) {
    return (
      <p role="status" className="p-6 text-brand-text">
        Checking session...
      </p>
    );
  }

  if (loadStatus === "loading" || loadStatus === "error") {
    return (
      <section className="rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs">
        <h1 className="mb-3 text-xl font-bold">Practice exam</h1>

        {loadStatus === "loading" ? (
          <p role="status">Loading exam...</p>
        ) : (
          <>
            <p role="alert" className="mb-4 text-sm text-red-700">
              {loadError}
            </p>

            <Button
              type="button"
              variant="outline"
              onClick={retryLoading}
              className="border-brand-border text-brand-text hover:bg-brand-surface"
            >
              Retry
            </Button>
          </>
        )}
      </section>
    );
  }

  if (!currentQuestion) {
    return (
      <section className="rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs">
        <h1 className="mb-2 text-xl font-bold">Practice exam</h1>

        <p role="status" className="text-brand-text/75">
          No questions are available for this attempt.
        </p>
      </section>
    );
  }

  const flaggedQuestionIndices = questions
    .map((question, index) => (question.flagged_for_review === true ? index : -1))
    .filter((index) => index !== -1);

  return (
    <div className="w-full space-y-6">
      <ExamHeader
        questionIndex={currentQuestionIndex}
        totalQuestions={questions.length}
        submittedCount={submittedCount}
        isFlagged={isFlagged}
        isSavingFlag={isSavingFlag}
        canToggleFlag={canToggleFlag}
        disabled={isSubmitting || isFinishing}
        flagError={flagError}
        onToggleFlag={handleToggleFlag}
      />

      <MobileQuestionNavigation
        totalQuestions={questions.length}
        currentQuestionIndex={currentQuestionIndex}
        questionStates={questionStates}
        disabled={isSubmitting || isFinishing}
        onNavigate={goToQuestion}
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <QuestionRenderer
          question={currentQuestion}
          questionIndex={currentQuestionIndex}
          totalQuestions={questions.length}
          selectedOptionIds={currentSelected}
          textValue={textValue}
          isSubmitted={isSubmitted}
          isSubmitting={isSubmitting}
          isFinishing={isFinishing}
          isSavingFlag={isSavingFlag}
          submitError={submitError}
          feedback={currentFeedback}
          allQuestionsSubmitted={allQuestionsSubmitted}
          firstUnsubmittedIndex={firstUnsubmittedIndex}
          onSelectOption={handleSelect}
          onTextChange={handleTextChange}
          onSubmit={handleSubmit}
          onPrevious={() => goToQuestion(currentQuestionIndex - 1)}
          onNext={() => goToQuestion(currentQuestionIndex + 1)}
          onReviewUnsubmitted={() =>
            goToQuestion(firstUnsubmittedIndex)
          }
        />

        <ExamSidebar
          currentQuestion={currentQuestion}
          currentQuestionIndex={currentQuestionIndex}
          totalQuestions={questions.length}
          questionStates={questionStates}
          flaggedQuestionIndices={flaggedQuestionIndices}
          selectedOptionIds={currentSelected}
          isSubmitted={isSubmitted}
          isSubmitting={isSubmitting}
          isFinishing={isFinishing}
          isSavingFlag={isSavingFlag}
          allQuestionsSubmitted={allQuestionsSubmitted}
          finishError={finishError}
          feedback={currentFeedback}
          onNavigate={goToQuestion}
          onFinish={handleFinish}
        />
      </div>
    </div>
  );
}