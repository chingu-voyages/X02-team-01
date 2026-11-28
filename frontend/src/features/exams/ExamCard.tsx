"use client";

import ExamHeader from "./ExamHeader";
import QuestionControls from "../questions/QuestionControls";
import QuestionRenderer from "./QuestionRenderer";
import { Button } from "@/components/ui/button";
import ExamSidebar from "./ExamSidebar";
import { useExamAttempt } from "@/hooks/useExamAttempt";

interface ExamCardProps { attemptId: string; }

export default function ExamCard({ attemptId }: ExamCardProps) {
  const {
    ready, token, questions, currentQuestionIndex, goToQuestion,
    loadStatus, loadError, retryLoading, currentQuestion,
    isEssay, isTextAnswer, currentSelected, isSubmitted, isAttemptSubmitted,
    currentFeedback, textValue, questionStates, submittedCount,
    allQuestionsSubmitted, firstUnsubmittedIndex, isSubmitting, submitError,
    submissionNotice, unsentDraft, validationMessage, isFinishing, finishError,
    isFlagged, isSavingFlag, flagError, canToggleFlag,
    handleToggleFlag, handleSelect, handleTextChange, handleSubmit, handleFinish, handleViewResults,
  } = useExamAttempt(attemptId);

  if (!ready || !token) return <p role="status" className="p-6 text-brand-text">Checking session...</p>;
  if (loadStatus === "loading" || loadStatus === "error") {
    return (
      <section className="rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs">
        <h1 className="mb-3 text-xl font-bold">Practice exam</h1>
        {loadStatus === "loading" ? <p role="status">Loading exam...</p> : (
          <>
            <p role="alert" className="mb-4 text-sm text-red-700">{loadError}</p>
            <Button type="button" variant="outline" onClick={retryLoading} className="border-brand-border text-brand-text hover:bg-brand-surface">Retry</Button>
          </>
        )}
      </section>
    );
  }
  if (!currentQuestion) {
    return (
      <section className="rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs">
        <h1 className="mb-2 text-xl font-bold">Practice exam</h1>
        <p role="status" className="text-brand-text/75">No questions are available for this attempt.</p>
      </section>
    );
  }
  const flaggedQuestionIndices = questions.map((question, index) => question.flagged_for_review === true ? index : -1).filter((index) => index !== -1);
  const selectedCount = isTextAnswer ? textValue.trim().length : currentSelected.length;
  // Keep legacy MC/short-answer-only exams unchanged. Mixed essay exams have one
  // Finish action beside the answer, not hidden inside the mobile disclosure.
  const finishInControls = questions.some((question) => question.question_type === "essay");
  const sidebarProps = {
    currentQuestion, currentQuestionIndex, totalQuestions: questions.length,
    questionStates, flaggedQuestionIndices, isSubmitted, isSubmitting,
    isFinishing, isSavingFlag, allQuestionsSubmitted, finishError,
    feedback: currentFeedback, finishInControls, readOnly: isAttemptSubmitted,
    onNavigate: goToQuestion, onFinish: handleFinish,
  };
  return (
    <div className="w-full min-w-0 space-y-6">
      <ExamHeader questionIndex={currentQuestionIndex} totalQuestions={questions.length}
        submittedCount={submittedCount} isFlagged={isFlagged} isSavingFlag={isSavingFlag}
        canToggleFlag={canToggleFlag} disabled={isSubmitting || isFinishing}
        flagError={flagError} onToggleFlag={handleToggleFlag} />
      {isAttemptSubmitted && (
        <div className="space-y-3 rounded-xl border border-brand-border bg-brand-surface p-4 text-brand-text">
          <p role="status">This exam has been submitted. Answers are read-only.</p>
          <Button type="button" onClick={handleViewResults} className="min-h-11">View results</Button>
        </div>
      )}
      <ExamSidebar {...sidebarProps} variant="mobile" />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <QuestionRenderer question={currentQuestion} selectedOptionIds={currentSelected} textValue={textValue}
            isSubmitted={isSubmitted} isSubmitting={isSubmitting} isFinishing={isFinishing}
            readOnly={isAttemptSubmitted} submitError={submitError} submissionNotice={submissionNotice}
            unsentDraft={unsentDraft} feedback={currentFeedback} onSelectOption={handleSelect} onTextChange={handleTextChange} />
          <QuestionControls questionIndex={currentQuestionIndex} totalQuestions={questions.length}
            selectedCount={selectedCount} isSubmitted={isSubmitted} isSubmitting={isSubmitting}
            isFinishing={isFinishing} isSavingFlag={isSavingFlag} allQuestionsSubmitted={allQuestionsSubmitted}
            firstUnsubmittedIndex={firstUnsubmittedIndex} submitBlocked={isEssay && Boolean(validationMessage)}
            submitHint={isEssay ? validationMessage : ""} allowDraftNavigation={isEssay}
            readOnly={isAttemptSubmitted} onSubmit={handleSubmit}
            onPrevious={() => goToQuestion(currentQuestionIndex - 1)} onNext={() => goToQuestion(currentQuestionIndex + 1)}
            onReviewUnsubmitted={() => goToQuestion(firstUnsubmittedIndex)}
            onFinish={finishInControls ? handleFinish : undefined} finishError={finishInControls ? finishError : ""} />
        </div>
        <ExamSidebar {...sidebarProps} variant="panel" />
      </div>
    </div>
  );
}
