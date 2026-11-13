"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { useDemoSession } from "@/features/auth/AuthProvider";
import QuestionRenderer from "./QuestionRenderer";

import type { AnswerSubmission, ExamQuestionWithResponse, FeedbackEntry } from "@/types/exam-api.types";
import { Button } from "@/components/ui/button";

type LoadStatus = "loading" | "ready" | "error";

interface ExamCardProps {
  attemptId: string;
}

function letterForPosition(position: number) {
  return position >= 1 && position <= 26
    ? String.fromCharCode(64 + position)
    : String(position);
}

export default function ExamCard({ attemptId }: ExamCardProps) {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [questions, setQuestions] = useState<ExamQuestionWithResponse[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedValuesMap, setSelectedValuesMap] = useState<
    Record<string, string[]>
  >({});
  const [textAnswersMap, setTextAnswersMap] = useState<Record<string, string>>(
    {},
  );
  const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackEntry>>(
    {},
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;

    getExam(attemptId, token)
      .then((data) => {
        if (cancelled) return;

        const restoredSubmitted: Record<string, boolean> = {};
        const restoredSelection: Record<string, string[]> = {};
        const restoredText: Record<string, string> = {};
        const restoredFeedback: Record<string, FeedbackEntry> = {};

        for (const question of data.questions) {
          if (!question.response) continue;

          const response = question.response;
          restoredSubmitted[question.id] = response.is_submitted;

          if (response.selected_option_ids) {
            restoredSelection[question.id] = response.selected_option_ids;
          }
          if (response.text_response) {
            restoredText[question.id] = response.text_response;
          }
          // Resume data does not expose correct-option IDs. Leave options
          // visually neutral even if a result verdict is available.
          if (typeof response.is_correct === "boolean") {
            restoredFeedback[question.id] = {
              feedback_released: false,
              is_correct: response.is_correct,
              correct_option_ids: [],
              explanation: null,
            };
          }
        }

        setQuestions(data.questions);
        setSubmittedMap(restoredSubmitted);
        setSelectedValuesMap(restoredSelection);
        setTextAnswersMap(restoredText);
        setFeedbackMap(restoredFeedback);
        setCurrentQuestionIndex(
          Math.max(
            0,
            Math.min(data.current_position - 1, data.questions.length - 1),
          ),
        );
        setSubmitError("");
        setFinishError("");
        setLoadError("");
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "Unable to load the exam.",
        );
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, attemptId, reloadKey, handleError]);

  function retryLoading() {
    setLoadStatus("loading");
    setLoadError("");
    setReloadKey((value) => value + 1);
  }

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

  const currentQuestion = questions[currentQuestionIndex];

  if (!currentQuestion) {
    return (
      <section className="rounded-md border border-[#d4d8db] bg-white p-6">
        <h1 className="mb-2 text-xl font-bold">Practice exam</h1>
        <p role="status">No questions are available for this attempt.</p>
      </section>
    );
  }

  const questionId = currentQuestion.id;
  const isShortAnswer = currentQuestion.question_type === "short_answer";
  const isMultiple = currentQuestion.allows_multiple_answers;
  const currentSelected = selectedValuesMap[questionId] || [];
  const isSubmitted = submittedMap[questionId] || false;
  const currentFeedback = feedbackMap[questionId];
  const textValue = textAnswersMap[questionId] ?? "";
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const submittedCount = questions.filter(
    (question) => submittedMap[question.id],
  ).length;
  const allQuestionsSubmitted =
    questions.length > 0 &&
    questions.every((question) => submittedMap[question.id] === true);
  const firstUnsubmittedIndex = questions.findIndex(
    (question) => !submittedMap[question.id],
  );
  const selectedLetters = currentQuestion.options
    .filter((option) => currentSelected.includes(option.id))
    .map((option) => letterForPosition(option.position))
    .join(", ");

  function handleSelect(optionId: string) {
    if (isSubmitted || isSubmitting || isFinishing) return;

    if (isMultiple) {
      setSelectedValuesMap((previous) => {
        const existing = previous[questionId] || [];
        const updated = existing.includes(optionId)
          ? existing.filter((id) => id !== optionId)
          : [...existing, optionId];
        return { ...previous, [questionId]: updated };
      });
    } else {
      setSelectedValuesMap((previous) => ({
        ...previous,
        [questionId]: [optionId],
      }));
    }
  }

  function handleTextChange(value: string) {
    if (isSubmitted || isSubmitting || isFinishing) return;
    setTextAnswersMap((previous) => ({ ...previous, [questionId]: value }));
  }

  function handleSubmit() {
    if (
      !token ||
      !currentQuestion ||
      isSubmitting ||
      isSubmitted ||
      isFinishing
    ) {
      return;
    }

    const answer: AnswerSubmission = isShortAnswer
      ? { selected_option_ids: null, text_response: textValue.trim() || null }
      : { selected_option_ids: currentSelected, text_response: null };
   

    if (
      !answer.text_response &&
      !(answer.selected_option_ids && answer.selected_option_ids.length > 0)
    ) {
      setSubmitError("Choose an answer before submitting.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    submitAnswer(attemptId, questionId, answer, token)
      .then((feedback) => {
        // FastAPI owns correctness and release timing; never grade locally.
        setFeedbackMap((previous) => ({
          ...previous,
          [questionId]: {
            feedback_released: feedback.feedback_released,
            is_correct:
              feedback.feedback_released &&
              typeof feedback.is_correct === "boolean"
                ? feedback.is_correct
                : null,
            correct_option_ids: feedback.feedback_released
              ? (feedback.correct_option_ids ?? [])
              : [],
            explanation: feedback.feedback_released
              ? (feedback.explanation ?? null)
              : null,
          },
        }));
        setSubmittedMap((previous) => ({ ...previous, [questionId]: true }));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          setSubmitError("This question was already submitted. Reloading...");
          setReloadKey((value) => value + 1);
          return;
        }
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Unable to submit the answer.",
        );
      })
      .finally(() => setIsSubmitting(false));
  }

  async function handleFinish() {
    if (
      !token ||
      !allQuestionsSubmitted ||
      isSubmitting ||
      finishingRef.current
    ) {
      return;
    }

    finishingRef.current = true;
    setIsFinishing(true);
    setFinishError("");
    let navigating = false;

    try {
      const response = await submitExam(attemptId, token);
      if (
        response.status !== "submitted" ||
        response.attempt_id !== attemptId
      ) {
        throw new Error("Unexpected final submission response.");
      }
      navigating = true;
      router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        // The request may already have succeeded in another tab.
        try {
          const current = await getExam(attemptId, token);
          if (current.status === "submitted") {
            navigating = true;
            router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
            return;
          }
        } catch (lookupError: unknown) {
          if (lookupError instanceof ApiError && lookupError.status === 401) {
            handleError(lookupError);
            return;
          }
        }
        setFinishError("Unable to finalize this attempt. Please try again.");
        return;
      }
      setFinishError(
        error instanceof Error ? error.message : "Unable to finish the exam.",
      );
    } finally {
      // Keep the Finish action disabled after navigation begins.
      if (!navigating) {
        finishingRef.current = false;
        setIsFinishing(false);
      }
    }
  }

  return (
    <div className="w-full space-y-6">
      {/* Same global-style navigation treatment as Categories and Results. */}
      <nav
        aria-label="Main navigation"
        className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-md border border-[#d4d8db] bg-white px-6 py-5"
      >
        <span className="text-sm font-extrabold tracking-tight">
          THE JOB HACKERS
        </span>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-semibold text-[#303639]">Exams</span>
          <span className="text-gray-300" aria-hidden="true">
            •
          </span>
          <span className="text-gray-400" title="Coming soon">
            My History
          </span>
          <span className="text-gray-300" aria-hidden="true">
            •
          </span>
          <span className="text-gray-400" title="Coming soon">
            Journal
          </span>
          <span className="text-gray-300" aria-hidden="true">
            •
          </span>
          <span className="text-gray-400" title="Coming soon">
            Account
          </span>
        </div>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Practice exam{" "}
          <span className="font-medium text-[#687178]">· In progress</span>
        </h1>
        <p className="text-sm text-[#687178]">
          Question {currentQuestionIndex + 1} of {questions.length}
          <span className="mx-2" aria-hidden="true">
            ·
          </span>
          {answeredStatus}
        </p>
      </header>

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
          onPrevious={() =>
            setCurrentQuestionIndex((previous) => Math.max(previous - 1, 0))
          }
          onNext={() =>
            setCurrentQuestionIndex((previous) =>
              Math.min(previous + 1, questions.length - 1),
            )
          }
          onReviewUnsubmitted={() => {
            if (firstUnsubmittedIndex >= 0) {
              setCurrentQuestionIndex(firstUnsubmittedIndex);
            }
          }}
        />

        <aside
          aria-labelledby="attempt-progress-heading"
          className="rounded-md border border-[#cbd0d3] bg-white p-5 sm:p-6"
        >
          <h2 id="attempt-progress-heading" className="text-base font-bold">
            Attempt progress
          </h2>
          <div className="mt-4 space-y-3 text-sm text-[#56616a]">
            <p>
              Question {currentQuestionIndex + 1} / {questions.length}
            </p>
            <p>
              Submitted answers: {submittedCount} / {questions.length}
            </p>
            <p>
              {isSubmitted
                ? isShortAnswer
                  ? "Submitted: short answer"
                  : `Submitted answer${isMultiple ? "s" : ""}: ${selectedLetters || "recorded"}`
                : "Current question not yet submitted"}
            </p>
          </div>
          <div className="my-5 border-t border-[#e2e5e7]" />

          {isLastQuestion && allQuestionsSubmitted ? (
            <Button
              type="button"
              onClick={handleFinish}
              disabled={isFinishing || isSubmitting}
              className="h-10 rounded-md bg-[#343a3e] px-5 text-sm text-white hover:bg-[#1e2427] disabled:opacity-50"
            >
              {isFinishing ? "Finishing exam..." : "Finish Exam"}
            </Button>
          ) : (
            <p className="text-sm text-[#687178]">
              Submit all questions to enable Finish Exam.
            </p>
          )}

          {finishError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {finishError}
            </p>
          )}

          {isSubmitted && (
            <p className="mt-4 text-xs leading-5 text-[#687178]">
              {typeof currentFeedback?.is_correct === "boolean"
                ? currentFeedback.is_correct
                  ? "✓ Correct · Answer locked for this attempt."
                  : "× Incorrect · Answer locked for this attempt."
                : "✓ Answer saved · Locked for this attempt."}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
