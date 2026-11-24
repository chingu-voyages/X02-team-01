"use client";

import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import {
  AnswerSubmission,
  ExamAttempt,
  ExamQuestionWithResponse,
  FeedbackEntry,
} from "@/types/exam-api.types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type LoadStatus = "loading" | "ready" | "error";
type FlagRequest = { attemptId: string; questionId: string };

export function useExamAttempt(attemptId: string) {
  const router = useRouter();
  const {token, ready, handleError} = useDemoSession();

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

  // JHEP-104: flag values live on the assigned questions. These states
  // track only request lifecycle and errors, not another copy of the flags.
  const [loadedAttempt, setLoadedAttempt] = useState<{
    id: string;
    status: ExamAttempt["status"];
    reloadKey: number;
  } | null>(null);
  const [pendingFlag, setPendingFlag] = useState<FlagRequest | null>(null);
  const [flagErrors, setFlagErrors] = useState<Record<string, string>>({});
  const flagRequestRef = useRef<FlagRequest | null>(null);

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
        setLoadedAttempt({ id: data.attempt_id, status: data.status, reloadKey });
        setPendingFlag(null);
        setFlagErrors({});
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
      // Ignore late responses after a reload, account change, or unmount.
      flagRequestRef.current = null;
    };
  }, [ready, token, attemptId, reloadKey, handleError]);

  function retryLoading() {
    setLoadStatus("loading");
    setLoadError("");
    setReloadKey((value) => value + 1);
  }

  const currentQuestion = questions[currentQuestionIndex];
  const questionId = currentQuestion?.id ?? "";
  const isShortAnswer = currentQuestion?.question_type === "short_answer";
  const isMultiple = currentQuestion?.allows_multiple_answers ?? false;
  const currentSelected = selectedValuesMap[questionId] || [];
  const isSubmitted = submittedMap[questionId] || false;
  const currentFeedback = feedbackMap[questionId];
  const textValue = textAnswersMap[questionId] ?? "";
  const submittedCount = questions.filter(
    (question) => submittedMap[question.id],
  ).length;
  const allQuestionsSubmitted =
    questions.length > 0 &&
    questions.every((question) => submittedMap[question.id] === true);
  const firstUnsubmittedIndex = questions.findIndex(
    (question) => !submittedMap[question.id],
  );

  const isFlagged = currentQuestion?.flagged_for_review === true;
  const flaggedQuestionIds = questions
    .filter((question) => question.flagged_for_review === true)
    .map((question) => question.id);
  const flagPendingQuestionId = pendingFlag?.attemptId === attemptId
    ? pendingFlag.questionId
    : null;
  const isSavingFlag = flagPendingQuestionId !== null;
  const flagError = flagErrors[questionId] ?? "";
  const canToggleFlag = Boolean(
    ready && token && loadStatus === "ready" &&
      loadedAttempt?.id === attemptId && loadedAttempt.reloadKey === reloadKey &&
      loadedAttempt.status === "in_progress" && currentQuestion &&
      !isSavingFlag && !isSubmitting && !isFinishing,
  );

  // Navigation changes only the active question. Answers and feedback remain
  // keyed by question ID for the lifetime of this attempt.
  function goToQuestion(index: number): boolean {
    if (
      !ready ||
      !token ||
      loadStatus !== "ready" ||
      isSubmitting ||
      isFinishing ||
      finishingRef.current ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= questions.length
    ) {
      return false;
    }

    if (index !== currentQuestionIndex) {
      setCurrentQuestionIndex(index);
      setSubmitError("");
    }

    return true;
  }

  async function handleToggleFlag(): Promise<void> {
    // Synchronous ref guards repeated clicks before React commits a render.
    if (!token || !canToggleFlag || !questionId ||
        flagRequestRef.current || finishingRef.current) {
      return;
    }

    const request = { attemptId, questionId };
    const desiredFlag = !isFlagged;
    flagRequestRef.current = request;
    setPendingFlag(request);
    setFlagErrors((previous) => ({ ...previous, [questionId]: "" }));

    try {
      const saved = await setQuestionFlag(
        attemptId, questionId, desiredFlag, token,
      );
      if (flagRequestRef.current !== request) return;
      if (!saved || saved.attempt_id !== attemptId ||
          saved.question_version_id !== questionId ||
          saved.flagged_for_review !== desiredFlag) {
        throw new Error("Unexpected flag response. Please try again.");
      }

      // Confirmed server state only. Navigation can continue while saving;
      // the captured ID ensures the update still targets the original item.
      setQuestions((previous) => previous.map((question) =>
        question.id === request.questionId
          ? { ...question, flagged_for_review: saved.flagged_for_review }
          : question,
      ));
    } catch (error: unknown) {
      if (flagRequestRef.current !== request) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setFlagErrors((previous) => ({
        ...previous,
        [questionId]: error instanceof ApiError && error.status === 409
          ? "This exam has already been submitted. Flags can no longer be changed."
          : error instanceof Error
            ? error.message
            : "Unable to save the review flag. Please try again.",
      }));
      if (error instanceof ApiError && error.status === 409) {
        setLoadedAttempt({ id: attemptId, status: "submitted", reloadKey });
      }
    } finally {
      if (flagRequestRef.current === request) {
        flagRequestRef.current = null;
        setPendingFlag(null);
      }
    }
  }

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
      isFinishing ||
      flagRequestRef.current
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
      flagRequestRef.current ||
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

  return {
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
    isFlagged,
    flaggedQuestionIds,
    flagPendingQuestionId,
    isSavingFlag,
    flagError,
    canToggleFlag,
    handleToggleFlag,
    handleSelect,
    handleTextChange,
    handleSubmit,
    handleFinish,
  };
}
