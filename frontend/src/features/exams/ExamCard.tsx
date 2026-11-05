"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import PageHeader from "@/components/layouts/PageHeader";

import { ApiError } from "@/lib/api-client";
import { getExam, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { useDemoSession } from "@/features/auth/AuthProvider";

import type {
  AnswerSubmission,
  ExamQuestionWithResponse,
} from "@/types/exam-api.types";

type LoadStatus = "loading" | "ready" | "error";

interface ExamCardProps {
  attemptId: string;
}

interface FeedbackEntry {
  feedback_released: boolean;
  is_correct: boolean | null;
  correct_option_ids: string[];
  explanation?: string | null;
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
          // The resume endpoint can provide a verdict without answer-key IDs.
          // Keep option styling neutral rather than assuming a wrong answer.
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
          Math.max(0, Math.min(data.current_position - 1, data.questions.length - 1)),
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
    return <p role="status" className="p-6">Checking session...</p>;
  }

  if (loadStatus === "loading" || loadStatus === "error") {
    return (
      <Card>
        <PageHeader title="Practice exam" status={loadStatus} />
        {loadStatus === "loading" && <p role="status">Loading exam...</p>}
        {loadStatus === "error" && (
          <>
            <p role="alert" className="text-red-700">{loadError}</p>
            <Button className="mt-2" variant="outline" onClick={retryLoading}>
              Retry
            </Button>
          </>
        )}
      </Card>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];

  if (!currentQuestion) {
    return (
      <Card>
        <PageHeader title="Practice exam" />
        <p role="status">No questions are available for this attempt.</p>
      </Card>
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
  const allQuestionsSubmitted =
    questions.length > 0 &&
    questions.every((question) => submittedMap[question.id] === true);
  const firstUnsubmittedIndex = questions.findIndex(
    (question) => !submittedMap[question.id],
  );

  const feedbackReleased = Boolean(
    currentFeedback?.feedback_released &&
    currentFeedback.correct_option_ids.length > 0,
  );

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
    if (!token || !currentQuestion || isSubmitting || isSubmitted || isFinishing) {
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
        setFeedbackMap((previous) => ({
          ...previous,
          [questionId]: {
            feedback_released: feedback.feedback_released,
            is_correct:
              feedback.feedback_released && typeof feedback.is_correct === "boolean"
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
          error instanceof Error ? error.message : "Unable to submit the answer.",
        );
      })
      .finally(() => setIsSubmitting(false));
  }

  async function handleFinish() {
    if (!token || !allQuestionsSubmitted || isSubmitting || finishingRef.current) {
      return;
    }

    finishingRef.current = true;
    setIsFinishing(true);
    setFinishError("");
    let navigating = false;

    try {
      const response = await submitExam(attemptId, token);
      if (response.status !== "submitted" || response.attempt_id !== attemptId) {
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
        // A prior successful request may have submitted the same attempt.
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
      // Keep the button disabled after successful navigation to avoid a
      // second POST while Next.js is transitioning to the results route.
      if (!navigating) {
        finishingRef.current = false;
        setIsFinishing(false);
      }
    }
  }

  const optionsList = currentQuestion.options.map((option) => (
    <OptionItem
      key={option.id}
      id={option.id}
      option={option.option_text}
      questionType={isMultiple ? "multiple" : "single"}
      isSelected={currentSelected.includes(option.id)}
      onSelect={() => handleSelect(option.id)}
      isSubmitted={isSubmitted}
      feedbackReleased={feedbackReleased}
      correctOptionIds={feedbackReleased ? currentFeedback.correct_option_ids : []}
    />
  ));

  const selectedCount = isShortAnswer
    ? textValue.trim().length
    : currentSelected.length;

  return (
    <Card>
      <PageHeader
        title="Practice exam"
        status={`Question ${currentQuestionIndex + 1} of ${questions.length}`}
      />
      <Badge
        questionNumber={currentQuestionIndex + 1}
        questionType={isShortAnswer ? "short_answer" : "multiple_choice"}
      />
      <h2 id="question-heading" className="my-3 text-base font-semibold sm:text-xl">
        {currentQuestion.question_text}
      </h2>

      {isShortAnswer ? (
        <div role="group" aria-labelledby="question-heading" className="flex flex-col gap-2">
          <textarea
            aria-label="Your answer"
            value={textValue}
            onChange={(event) => handleTextChange(event.target.value)}
            disabled={isSubmitted || isSubmitting || isFinishing}
            placeholder="Type your answer..."
            className="min-h-24 w-full rounded-sm border border-gray-300 p-3 text-sm disabled:opacity-60"
          />
          {isSubmitted && (
            <p className="text-sm text-gray-600" role="status">
              Answer recorded — short answers are not automatically graded.
            </p>
          )}
        </div>
      ) : isMultiple ? (
        <div role="group" aria-labelledby="question-heading" className="flex flex-col gap-2">
          {optionsList}
        </div>
      ) : (
        <RadioGroup
          value={currentSelected[0] || ""}
          onValueChange={handleSelect}
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          {optionsList}
        </RadioGroup>
      )}

      {!isShortAnswer && isSubmitted && typeof currentFeedback?.is_correct === "boolean" && (
        <p
          role="status"
          className={`mt-4 rounded-md border p-3 text-sm font-medium ${
            currentFeedback.is_correct
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {currentFeedback.is_correct ? "Correct answer." : "Incorrect answer."}
        </p>
      )}

      {currentFeedback?.explanation && (
        <div className="mt-4 rounded-sm border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <strong>Explanation:</strong> {currentFeedback.explanation}
        </div>
      )}

      {submitError && <p role="alert" className="mt-2 text-sm text-red-700">{submitError}</p>}
      {finishError && <p role="alert" className="mt-2 text-sm text-red-700">{finishError}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setCurrentQuestionIndex((previous) => Math.max(previous - 1, 0))}
          disabled={currentQuestionIndex === 0 || isSubmitting || isFinishing}
          className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer"
        >
          Previous
        </Button>

        {isSubmitted ? (
          isLastQuestion ? (
            allQuestionsSubmitted ? (
              <Button
                type="button"
                onClick={handleFinish}
                disabled={isFinishing || isSubmitting}
                className="rounded-sm bg-[#343a3e] px-6 py-5 text-base text-white hover:bg-[#1e2427] disabled:opacity-50"
              >
                {isFinishing ? "Finishing exam..." : "Finish Exam"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (firstUnsubmittedIndex >= 0) {
                    setCurrentQuestionIndex(firstUnsubmittedIndex);
                  }
                }}
                disabled={isFinishing}
              >
                Review unanswered questions
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={() =>
                setCurrentQuestionIndex((previous) =>
                  Math.min(previous + 1, questions.length - 1),
                )
              }
              disabled={isFinishing}
              className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer"
            >
              Next question
            </Button>
          )
        ) : (
          <Button
            type="button"
            disabled={selectedCount === 0 || isSubmitting || isFinishing}
            onClick={handleSubmit}
            className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit answer"}
          </Button>
        )}
      </div>
    </Card>
  );
}
