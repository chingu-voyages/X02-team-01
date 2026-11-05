"use client";

import { useEffect, useState } from "react";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import PageHeader from "@/components/layouts/PageHeader";

import { ApiError } from "@/lib/api-client";
import { getExam, submitAnswer } from "@/lib/exam-api";
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
  const { token, ready, handleError } = useDemoSession();

  const [questions, setQuestions] = useState<
    ExamQuestionWithResponse[]
  >([]);

  const [currentQuestionIndex, setCurrentQuestionIndex] =
    useState(0);

  const [loadStatus, setLoadStatus] =
    useState<LoadStatus>("loading");

  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Store selected options for each question.
  const [selectedValuesMap, setSelectedValuesMap] = useState<
    Record<string, string[]>
  >({});

  // Store short-answer responses.
  const [textAnswersMap, setTextAnswersMap] = useState<
    Record<string, string>
  >({});

  // Track submitted and locked questions.
  const [submittedMap, setSubmittedMap] = useState<
    Record<string, boolean>
  >({});

  // Only show correctness information released by FastAPI.
  const [feedbackMap, setFeedbackMap] = useState<
    Record<string, FeedbackEntry>
  >({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Load the existing exam and restore saved responses.
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

          restoredSubmitted[question.id] =
            response.is_submitted;

          if (response.selected_option_ids) {
            restoredSelection[question.id] =
              response.selected_option_ids;
          }

          if (response.text_response) {
            restoredText[question.id] =
              response.text_response;
          }

          // The resume endpoint may return a verdict
          // without returning the correct-option IDs.
          // Keep options neutral unless those IDs are known.
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
            Math.min(
              data.current_position - 1,
              data.questions.length - 1,
            ),
          ),
        );

        setSubmitError("");
        setLoadError("");
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        if (
          error instanceof ApiError &&
          error.status === 401
        ) {
          handleError(error);
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load the exam.",
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

  // Authentication loading state.
  if (!ready || !token) {
    return (
      <p role="status" className="p-6">
        Checking session...
      </p>
    );
  }

  // Exam loading and error states.
  if (loadStatus === "loading" || loadStatus === "error") {
    return (
      <Card>
        <PageHeader
          title="Practice exam"
          status={loadStatus}
        />

        {loadStatus === "loading" && (
          <p role="status">Loading exam...</p>
        )}

        {loadStatus === "error" && (
          <>
            <p role="alert" className="text-red-700">
              {loadError}
            </p>

            <Button
              className="mt-2"
              variant="outline"
              onClick={retryLoading}
            >
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
        <PageHeader title="Practice exam complete" />

        <p aria-live="polite">
          You reached the end of your questions.
          Final submission and results arrive in
          the next integration checkpoint.
        </p>
      </Card>
    );
  }

  const questionId = currentQuestion.id;

  const isShortAnswer =
    currentQuestion.question_type === "short_answer";

  const isMultiple =
    currentQuestion.allows_multiple_answers;

  const currentSelected =
    selectedValuesMap[questionId] || [];

  const isSubmitted =
    submittedMap[questionId] || false;

  const currentFeedback =
    feedbackMap[questionId];

  const textValue =
    textAnswersMap[questionId] ?? "";

  const isLastQuestion =
    currentQuestionIndex >= questions.length - 1;

  // A submission response can disclose correctness
  // without disclosing the complete answer-option IDs.
  const feedbackReleased = Boolean(
    currentFeedback?.feedback_released &&
    currentFeedback.correct_option_ids.length > 0,
  );

  // Handle multiple-choice option selection.
  function handleSelect(optionId: string) {
    if (isSubmitted || isSubmitting) return;

    if (isMultiple) {
      setSelectedValuesMap((prev) => {
        const existing = prev[questionId] || [];

        const updated = existing.includes(optionId)
          ? existing.filter((id) => id !== optionId)
          : [...existing, optionId];

        return {
          ...prev,
          [questionId]: updated,
        };
      });
    } else {
      setSelectedValuesMap((prev) => ({
        ...prev,
        [questionId]: [optionId],
      }));
    }
  }

  // Handle short-answer input.
  function handleTextChange(value: string) {
    if (isSubmitted || isSubmitting) return;

    setTextAnswersMap((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  }

  // Submit and lock a question through FastAPI.
  function handleSubmit() {
    if (
      !token ||
      !currentQuestion ||
      isSubmitting ||
      isSubmitted
    ) {
      return;
    }

    const answer: AnswerSubmission = isShortAnswer
      ? {
          selected_option_ids: null,
          text_response: textValue.trim() || null,
        }
      : {
          selected_option_ids: currentSelected,
          text_response: null,
        };

    if (
      !answer.text_response &&
      !(
        answer.selected_option_ids &&
        answer.selected_option_ids.length > 0
      )
    ) {
      setSubmitError(
        "Choose an answer before submitting.",
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    submitAnswer(attemptId, questionId, answer, token)
      .then((feedback) => {
        // Store only correctness information
        // explicitly released by the backend.
        setFeedbackMap((prev) => ({
          ...prev,
          [questionId]: {
            feedback_released:
              feedback.feedback_released,

            is_correct:
              feedback.feedback_released &&
              typeof feedback.is_correct === "boolean"
                ? feedback.is_correct
                : null,

            correct_option_ids:
              feedback.feedback_released
                ? (feedback.correct_option_ids ?? [])
                : [],

            explanation:
              feedback.feedback_released
                ? (feedback.explanation ?? null)
                : null,
          },
        }));

        // Lock the question only after
        // successful backend submission.
        setSubmittedMap((prev) => ({
          ...prev,
          [questionId]: true,
        }));
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          error.status === 401
        ) {
          handleError(error);
          return;
        }

        if (
          error instanceof ApiError &&
          error.status === 409
        ) {
          // Reload state when the question
          // has already been locked elsewhere.
          setSubmitError(
            "This question was already submitted. Reloading...",
          );

          setReloadKey((value) => value + 1);
          return;
        }

        setSubmitError(
          error instanceof Error
            ? error.message
            : "Unable to submit the answer.",
        );
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  // Render answer options.
  const optionsList = currentQuestion.options.map(
    (option) => (
      <OptionItem
        key={option.id}
        id={option.id}
        option={option.option_text}
        questionType={
          isMultiple ? "multiple" : "single"
        }
        isSelected={currentSelected.includes(option.id)}
        onSelect={() => handleSelect(option.id)}
        isSubmitted={isSubmitted}
        feedbackReleased={feedbackReleased}
        correctOptionIds={
          feedbackReleased
            ? currentFeedback.correct_option_ids
            : []
        }
      />
    ),
  );

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
        questionType={
          isShortAnswer
            ? "short_answer"
            : "multiple_choice"
        }
      />

      <h2
        id="question-heading"
        className="my-3 text-base font-semibold sm:text-xl"
      >
        {currentQuestion.question_text}
      </h2>

      {/* Answer input */}
      {isShortAnswer ? (
        <div
          role="group"
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          <textarea
            aria-label="Your answer"
            value={textValue}
            onChange={(event) =>
              handleTextChange(event.target.value)
            }
            disabled={isSubmitted || isSubmitting}
            placeholder="Type your answer..."
            className="min-h-24 w-full rounded-sm border border-gray-300 p-3 text-sm disabled:opacity-60"
          />

          {isSubmitted && (
            <p
              className="text-sm text-gray-600"
              role="status"
            >
              Answer recorded — short answers are
              not automatically graded.
            </p>
          )}
        </div>
      ) : isMultiple ? (
        <div
          role="group"
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          {optionsList}
        </div>
      ) : (
        <RadioGroup
          value={currentSelected[0] || ""}
          onValueChange={(value) =>
            handleSelect(value)
          }
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          {optionsList}
        </RadioGroup>
      )}

      {/* Backend-provided correctness verdict */}
      {!isShortAnswer &&
        isSubmitted &&
        typeof currentFeedback?.is_correct ===
          "boolean" && (
          <p
            role="status"
            className={`mt-4 rounded-md border p-3 text-sm font-medium ${
              currentFeedback.is_correct
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {currentFeedback.is_correct
              ? "Correct answer."
              : "Incorrect answer."}
          </p>
        )}

      {/* Explanation released by backend */}
      {currentFeedback?.explanation && (
        <div className="mt-4 rounded-sm border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <strong>Explanation:</strong>{" "}
          {currentFeedback.explanation}
        </div>
      )}

      {/* Submission error */}
      {submitError && (
        <p
          role="alert"
          className="mt-2 text-sm text-red-700"
        >
          {submitError}
        </p>
      )}

      {/* Question navigation */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setCurrentQuestionIndex((prev) =>
              Math.max(prev - 1, 0),
            );
          }}
          disabled={
            currentQuestionIndex === 0 ||
            isSubmitting
          }
          className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer"
        >
          Previous
        </Button>

        {isSubmitted ? (
          isLastQuestion ? (
            // JHEP-100 handles final exam submission
            // and navigation to the results page.
            <div
              className="flex items-center rounded-sm border border-[#d4d8db] bg-white px-6 py-5 text-base"
              aria-live="polite"
            >
              Exam complete — final submission
              arrives in the next checkpoint.
            </div>
          ) : (
            <Button
              onClick={() => {
                setCurrentQuestionIndex((prev) =>
                  Math.min(
                    prev + 1,
                    questions.length - 1,
                  ),
                );
              }}
              className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer"
            >
              Next question
            </Button>
          )
        ) : (
          <Button
            disabled={
              selectedCount === 0 ||
              isSubmitting
            }
            onClick={handleSubmit}
            className="rounded-sm border border-gray-300 px-3 py-5 text-base hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? "Submitting..."
              : "Submit answer"}
          </Button>
        )}
      </div>
    </Card>
  );
}
