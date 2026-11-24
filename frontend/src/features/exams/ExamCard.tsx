"use client";

import QuestionRenderer from "./QuestionRenderer";
import PageHeader from "@/components/layouts/PageHeader";
import { Button } from "@/components/ui/button";
import ExamSidebar from "./ExamSidebar";
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
    isShortAnswer,
    isMultiple,
    currentSelected,
    isSubmitted,
    currentFeedback,
    textValue,
    submittedCount,
    allQuestionsSubmitted,
    firstUnsubmittedIndex,
    isSubmitting,
    submitError,
    isFinishing,
    finishError,
    handleSelect,
    handleTextChange,
    handleSubmit,
    handleFinish,
  } = useExamAttempt(attemptId);

  if (!ready || !token) {
    return (
      <p role="status" className="p-6">
        Checking session...
      </p>
    );
  }

  if (loadStatus === "loading" || loadStatus === "error") {
    return (
      <section className="rounded-md border border-[#d4d8db] bg-white p-6">
        <h1 className="mb-3 text-xl font-bold">Practice exam</h1>
        {loadStatus === "loading" ? (
          <p role="status">Loading exam...</p>
        ) : (
          <>
            <p role="alert" className="mb-4 text-sm text-red-700">
              {loadError}
            </p>
            <Button type="button" variant="outline" onClick={retryLoading}>
              Retry
            </Button>
          </>
        )}
      </section>
    );
  }

  if (!currentQuestion) {
    return (
      <section className="rounded-md border border-[#d4d8db] bg-white p-6">
        <h1 className="mb-2 text-xl font-bold">Practice exam</h1>
        <p role="status">No questions are available for this attempt.</p>
      </section>
    );
  }

  const answeredStatus = isSubmitted
    ? typeof currentFeedback?.is_correct === "boolean" ||
      Boolean(currentFeedback?.explanation)
      ? "Answer submitted. Feedback shown below."
      : "Answer submitted. Answer locked for this attempt."
    : isMultiple
      ? "Choose all that apply, then submit your answer."
      : isShortAnswer
        ? "Type your answer, then submit."
        : "Choose an answer, then submit.";

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Practice exam"
        status="In progress"
        stepLabel={`Question ${currentQuestionIndex + 1} of ${questions.length}`}
        subtitle={answeredStatus}
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
          submitError={submitError}
          feedback={currentFeedback}
          allQuestionsSubmitted={allQuestionsSubmitted}
          firstUnsubmittedIndex={firstUnsubmittedIndex}
          onSelectOption={handleSelect}
          onTextChange={handleTextChange}
          onSubmit={handleSubmit}
          onPrevious={() => goToQuestion(currentQuestionIndex - 1)}
          onNext={() => goToQuestion(currentQuestionIndex + 1)}
          onReviewUnsubmitted={() => goToQuestion(firstUnsubmittedIndex)}
        />

        <ExamSidebar
          currentQuestion={currentQuestion}
          currentQuestionIndex={currentQuestionIndex}
          totalQuestions={questions.length}
          submittedCount={submittedCount}
          selectedOptionIds={currentSelected}
          isSubmitted={isSubmitted}
          isSubmitting={isSubmitting}
          isFinishing={isFinishing}
          allQuestionsSubmitted={allQuestionsSubmitted}
          finishError={finishError}
          feedback={currentFeedback}
          onFinish={handleFinish}
        />
      </div>
    </div>
  );
}
