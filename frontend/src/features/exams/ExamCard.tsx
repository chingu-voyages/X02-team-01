"use client";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import OptionItem from "@/features/questions/OptionItem";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { useEffect, useState } from "react";
import PageHeader from "../../components/layouts/PageHeader";

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
  is_correct: boolean | undefined | null;
  correct_option_ids: string[];
  explanation?: string | null;
}

export default function ExamCard({ attemptId }: ExamCardProps) {
  const { token, ready, handleError } = useDemoSession();

  const [questions, setQuestions] = useState<ExamQuestionWithResponse[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Map each question's version ID to the learner's saved answer
  const [selectedValuesMap, setSelectedValuesMap] = useState<
    Record<string, string[]>
  >({});
  const [textAnswersMap, setTextAnswersMap] = useState<Record<string, string>>(
    {},
  );

  // Track which questions have been submitted (locked)
  const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});

  // Feedback per question version ID - only populated when the backend
  // released it. Deferred mode omits it; absence is NOT a wrong answer.
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackEntry>>(
    {},
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

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
          restoredSubmitted[question.id] = question.response.is_submitted;
          if (question.response.selected_option_ids) {
            restoredSelection[question.id] =
              question.response.selected_option_ids;
          }
          if (question.response.text_response) {
            restoredText[question.id] = question.response.text_response;
            restoredSelection[question.id] ??= [];
          }
          if (question.response.is_correct !== undefined) {
            restoredFeedback[question.id] = {
              is_correct: question.response.is_correct,
              correct_option_ids: [],
            };
          }
        }

        setQuestions(data.questions);
        setSubmittedMap(restoredSubmitted);
        setSelectedValuesMap(restoredSelection);
        setTextAnswersMap(restoredText);
        setFeedbackMap(restoredFeedback);
        setCurrentQuestionIndex(data.current_position - 1);
        setLoadStatus("ready");
        setLoadError("");
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
      <Card>
        <PageHeader title="Practice exam" status={loadStatus} />
        {loadStatus === "loading" ? <p>Loading exam...</p> : null}
        {loadStatus === "error" ? (
          <>
            <p className="text-red-700">{loadError}</p>
            <Button className="mt-2" variant="outline" onClick={retryLoading}>
              Retry
            </Button>
          </>
        ) : null}
      </Card>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];

  if (!currentQuestion) {
    return (
      <Card>
        <PageHeader title="Practice exam complete" />
        <p aria-live="polite">
          You reached the end of your questions. Final submission and results
          arrive in the next step.
        </p>
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

  const handleSelect = (optionId: string) => {
    if (isSubmitted || isSubmitting) return;

    if (isMultiple) {
      setSelectedValuesMap((prev) => {
        const existingList = prev[questionId] || [];
        const updatedList = existingList.includes(optionId)
          ? existingList.filter((id) => id !== optionId)
          : [...existingList, optionId];
        return { ...prev, [questionId]: updatedList };
      });
    } else {
      setSelectedValuesMap((prev) => ({ ...prev, [questionId]: [optionId] }));
    }
  };

  function handleTextChange(value: string) {
    setTextAnswersMap((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleSubmit() {
    if (!currentQuestion || isSubmitting || isSubmitted) return;
    if (!token) return;

    const answer: AnswerSubmission = isShortAnswer
      ? { selected_option_ids: null, text_response: textValue.trim() || null }
      : { selected_option_ids: currentSelected, text_response: null };

    // Empty answers are rejected by the backend with 422; guard locally too.
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
        setFeedbackMap((prev) => ({
          ...prev,
          [questionId]: {
            is_correct: feedback.is_correct,
            correct_option_ids: feedback.correct_option_ids ?? [],
            explanation: feedback.explanation ?? null,
          },
        }));
        setSubmittedMap((prev) => ({ ...prev, [questionId]: true }));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }

        if (error instanceof ApiError && error.status === 409) {
          // Locked elsewhere: refresh the attempt state instead of retrying.
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
      .finally(() => {
        setIsSubmitting(false);
      });
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
      feedbackReleased={Boolean(currentFeedback)}
      correctOptionIds={currentFeedback?.correct_option_ids || []}
    />
  ));

  const selectedCount = isShortAnswer
    ? textValue.trim().length
    : currentSelected.length;

  return (
    <Card>
      <PageHeader
        title="Practice exam"
        status={
          loadStatus === "ready"
            ? `Question ${currentQuestionIndex + 1} of ${questions.length}`
            : undefined
        }
      />
      <Badge
        questionNumber={currentQuestionIndex + 1}
        questionType={isShortAnswer ? "short answer" : "multiple choice"}
      />
      <h2
        id="question-heading"
        className="text-base sm:text-xl font-semibold my-3"
      >
        {currentQuestion.question_text}
      </h2>

      {isShortAnswer ? (
        <div
          role="group"
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          <textarea
            aria-label="Your answer"
            value={textValue}
            onChange={(event) => handleTextChange(event.target.value)}
            disabled={isSubmitted}
            placeholder="Type your answer..."
            className="min-h-24 w-full rounded-sm border border-gray-300 p-3 text-sm disabled:opacity-60"
          />
          {isSubmitted ? (
            <p className="text-sm text-gray-600" role="status">
              Answer recorded — short answers are not auto-graded.
            </p>
          ) : null}
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
          onValueChange={(val) => handleSelect(val)}
          aria-labelledby="question-heading"
          className="flex flex-col gap-2"
        >
          {optionsList}
        </RadioGroup>
      )}

      {currentFeedback?.explanation ? (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-sm text-sm text-blue-900">
          <strong>Explanation:</strong> {currentFeedback.explanation}
        </div>
      ) : null}

      {submitError ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {submitError}
        </p>
      ) : null}

      <div className="flex gap-2 mt-2">
        <Button
          variant="outline"
          onClick={() => {
            setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
          }}
          disabled={currentQuestionIndex === 0 || isSubmitting}
          className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm"
        >
          Previous
        </Button>
        {isSubmitted ? (
          isLastQuestion ? (
            // Checkpoint 5 owns final submission (`POST /exams/{id}/submit`)
            // and the results navigation; do not rebuild them here.
            <div
              className="flex items-center px-6 py-5 text-base border border-[#d4d8db] rounded-sm bg-white"
              aria-live="polite"
            >
              Exam complete — final submission arrives in the next checkpoint.
            </div>
          ) : (
            <Button
              onClick={() => {
                setCurrentQuestionIndex((prev) =>
                  Math.min(prev + 1, questions.length - 1),
                );
              }}
              className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm"
            >
              Next question
            </Button>
          )
        ) : (
          <Button
            disabled={selectedCount === 0 || isSubmitting}
            onClick={handleSubmit}
            className="hover:cursor-pointer py-5 px-3 text-base border border-gray-300 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Submitting..." : "Submit answer"}
          </Button>
        )}
      </div>
    </Card>
  );
}
