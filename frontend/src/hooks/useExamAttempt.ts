"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { submitExam } from "@/lib/exam-submission";
import { deriveQuestionStates } from "@/lib/question-states";
import {
  answerValidationMessage,
  buildAnswerSubmission,
  isMatchingSubmission,
  isWrittenQuestion,
  submissionFeedback,
} from "@/lib/exam-response";
import type { ExamAttempt, FeedbackEntry } from "@/types/exam-api.types";

type LoadStatus = "loading" | "ready" | "error";
type Scope = { attemptId: string; token: string | null; ready: boolean; reloadKey: number };
type Generation = { scope: Scope };
type QuestionRequest = { generation: Generation; questionId: string };
type AttemptView = {
  scope: Scope;
  attempt: ExamAttempt;
  index: number;
  selections: Record<string, string[]>;
  texts: Record<string, string>;
  submitted: Record<string, boolean>;
  feedback: Record<string, FeedbackEntry>;
  submitErrors: Record<string, string>;
  flagErrors: Record<string, string>;
  notices: Record<string, string>;
  unsentDrafts: Record<string, string>;
};

function restoreAttempt(scope: Scope, attempt: ExamAttempt): AttemptView {
  const view: AttemptView = {
    scope, attempt,
    index: Math.max(0, Math.min(attempt.current_position - 1, attempt.questions.length - 1)),
    selections: {}, texts: {}, submitted: {}, feedback: {},
    submitErrors: {}, flagErrors: {}, notices: {}, unsentDrafts: {},
  };
  for (const question of attempt.questions) {
    const response = question.response;
    if (!response) continue;
    view.submitted[question.id] = response.is_submitted;
    if (response.selected_option_ids) view.selections[question.id] = response.selected_option_ids;
    if (response.text_response !== null) view.texts[question.id] = response.text_response;
    if (question.question_type === "essay" && response.is_submitted) {
      view.feedback[question.id] = submissionFeedback("essay");
    } else if (typeof response.is_correct === "boolean") {
      // Resume payloads contain no correct-option IDs. Keep options neutral.
      view.feedback[question.id] = {
        feedback_released: false, is_correct: response.is_correct,
        correct_option_ids: [], explanation: null,
      };
    }
  }
  return view;
}

export function useExamAttempt(attemptId: string) {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();
  const [reloadKey, setReloadKey] = useState(0);
  const scope = useMemo<Scope>(
    () => ({ attemptId, token: token ?? null, ready, reloadKey }),
    [attemptId, token, ready, reloadKey],
  );
  const [storedView, setView] = useState<AttemptView | null>(null);
  const [load, setLoad] = useState<{ scope: Scope; status: LoadStatus; error: string } | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<QuestionRequest | null>(null);
  const [pendingFlag, setPendingFlag] = useState<QuestionRequest | null>(null);
  const [pendingFinish, setPendingFinish] = useState<Generation | null>(null);
  const [finishFailure, setFinishFailure] = useState<{ scope: Scope; message: string } | null>(null);

  // Ref guards are synchronous: a second click in the same React batch is blocked.
  // A generation is per Effect execution, including Strict Mode's setup/cleanup.
  const generationRef = useRef<Generation | null>(null);
  const answerRequestRef = useRef<QuestionRequest | null>(null);
  const flagRequestRef = useRef<QuestionRequest | null>(null);
  const finishRequestRef = useRef<Generation | null>(null);
  const confirmedQuestionsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!scope.ready || !scope.token) return;
    const generation: Generation = { scope };
    generationRef.current = generation;
    confirmedQuestionsRef.current = new Set();
    let cancelled = false;
    getExam(scope.attemptId, scope.token)
      .then((data) => {
        if (cancelled || generationRef.current !== generation) return;
        if (data.attempt_id !== scope.attemptId) throw new Error("Unexpected exam response. Please retry.");
        const restored = restoreAttempt(scope, data);
        confirmedQuestionsRef.current = new Set(
          Object.keys(restored.submitted).filter((id) => restored.submitted[id]),
        );
        setView(restored);
        setPendingAnswer(null);
        setPendingFlag(null);
        setPendingFinish(null);
        setFinishFailure(null);
        setLoad({ scope, status: "ready", error: "" });
      })
      .catch((error: unknown) => {
        if (cancelled || generationRef.current !== generation) return;
        setLoad({ scope, status: "error", error: error instanceof Error ? error.message : "Unable to load the exam." });
        if (error instanceof ApiError && error.status === 401) handleError(error);
      });
    return () => {
      cancelled = true;
      if (generationRef.current === generation) {
        generationRef.current = null;
        answerRequestRef.current = null;
        flagRequestRef.current = null;
        finishRequestRef.current = null;
      }
    };
  }, [scope, handleError]);

  // Hide the previous attempt/account synchronously, before the loading Effect runs.
  const view = storedView?.scope === scope ? storedView : null;
  const loadStatus: LoadStatus = load?.scope === scope ? load.status : "loading";
  const questions = view?.attempt.questions ?? [];
  const currentQuestionIndex = view?.index ?? 0;
  const currentQuestion = questions[currentQuestionIndex];
  const questionId = currentQuestion?.id ?? "";
  const isShortAnswer = currentQuestion?.question_type === "short_answer";
  const isEssay = currentQuestion?.question_type === "essay";
  const isTextAnswer = currentQuestion ? isWrittenQuestion(currentQuestion.question_type) : false;
  const isMultiple = currentQuestion?.allows_multiple_answers ?? false;
  const currentSelected = view?.selections[questionId] ?? [];
  const textValue = view?.texts[questionId] ?? "";
  const isSubmitted = view?.submitted[questionId] === true;
  const isAttemptSubmitted = view?.attempt.status === "submitted";
  const isSubmitting = pendingAnswer?.generation.scope === scope;
  const isFinishing = pendingFinish?.scope === scope;
  const isSavingFlag = pendingFlag?.generation.scope === scope;
  const isFlagged = currentQuestion?.flagged_for_review === true;
  const usable = Boolean(ready && token && view && loadStatus === "ready");
  const editable = usable && !isAttemptSubmitted;
  const canToggleFlag = Boolean(editable && currentQuestion && !isSavingFlag && !isSubmitting && !isFinishing);
  const progress = deriveQuestionStates({
    questions, currentQuestionIndex, submittedMap: view?.submitted ?? {},
    selectedValuesMap: view?.selections ?? {}, textAnswersMap: view?.texts ?? {},
  });
  const validationMessage = currentQuestion
    ? answerValidationMessage(currentQuestion.question_type, textValue, currentSelected)
    : "";

  function updateView(update: (previous: AttemptView) => AttemptView) {
    setView((previous) => previous?.scope === scope ? update(previous) : previous);
  }

  function currentGeneration(): Generation | null {
    const generation = generationRef.current;
    return generation?.scope === scope ? generation : null;
  }

  function retryLoading() { setReloadKey((value) => value + 1); }

  function goToQuestion(index: number): boolean {
    if (!usable || isSubmitting || isFinishing || answerRequestRef.current ||
        finishRequestRef.current || !Number.isInteger(index) || index < 0 || index >= questions.length) return false;
    updateView((previous) => ({ ...previous, index }));
    return true;
  }

  function handleSelect(optionId: string) {
    if (!editable || isSubmitted || isSubmitting || isFinishing ||
        answerRequestRef.current || finishRequestRef.current || !currentQuestion || isTextAnswer) return;
    updateView((previous) => {
      const selected = previous.selections[questionId] ?? [];
      const next = isMultiple
        ? selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]
        : [optionId];
      return { ...previous, selections: { ...previous.selections, [questionId]: next } };
    });
  }

  function handleTextChange(value: string) {
    if (!editable || isSubmitted || isSubmitting || isFinishing ||
        answerRequestRef.current || finishRequestRef.current || !isTextAnswer) return;
    updateView((previous) => ({ ...previous, texts: { ...previous.texts, [questionId]: value } }));
  }

  async function handleToggleFlag(): Promise<void> {
    const generation = currentGeneration();
    if (!token || !generation || !canToggleFlag || !questionId || flagRequestRef.current ||
        answerRequestRef.current || finishRequestRef.current) return;
    const request: QuestionRequest = { generation, questionId };
    flagRequestRef.current = request;
    setPendingFlag(request);
    updateView((previous) => ({ ...previous, flagErrors: { ...previous.flagErrors, [questionId]: "" } }));
    try {
      const saved = await setQuestionFlag(attemptId, questionId, !isFlagged, token);
      if (generationRef.current !== generation || flagRequestRef.current !== request) return;
      if (!saved || saved.attempt_id !== attemptId || saved.question_version_id !== questionId ||
          saved.flagged_for_review !== !isFlagged) throw new Error("Unexpected flag response. Please try again.");
      updateView((previous) => ({
        ...previous, attempt: { ...previous.attempt, questions: previous.attempt.questions.map((question) =>
          question.id === questionId ? { ...question, flagged_for_review: saved.flagged_for_review } : question,
        ) },
      }));
    } catch (error: unknown) {
      if (generationRef.current !== generation || flagRequestRef.current !== request) return;
      if (error instanceof ApiError && error.status === 401) { handleError(error); return; }
      const closed = error instanceof ApiError && error.status === 409;
      updateView((previous) => ({
        ...previous,
        attempt: closed ? { ...previous.attempt, status: "submitted" } : previous.attempt,
        flagErrors: { ...previous.flagErrors, [questionId]: closed
          ? "This exam has already been submitted. Flags can no longer be changed."
          : error instanceof Error ? error.message : "Unable to save the review flag. Please try again." },
      }));
    } finally {
      if (flagRequestRef.current === request) { flagRequestRef.current = null; setPendingFlag(null); }
    }
  }

  // Keep the existing event-handler contract (void). Existing consumers and
  // synchronous React act() calls must not accidentally receive a Promise.
  function handleSubmit(): void {
    void submitCurrentAnswer();
  }

  async function submitCurrentAnswer(): Promise<void> {
    const generation = currentGeneration();
    if (!token || !generation || !editable || !currentQuestion || isSubmitted || isSubmitting || isFinishing ||
        answerRequestRef.current || flagRequestRef.current || finishRequestRef.current || confirmedQuestionsRef.current.has(questionId)) return;
    if (validationMessage) {
      updateView((previous) => ({ ...previous, submitErrors: { ...previous.submitErrors, [questionId]: validationMessage } }));
      return;
    }
    const type = currentQuestion.question_type;
    const answer = buildAnswerSubmission(type, textValue, currentSelected);
    const request: QuestionRequest = { generation, questionId };
    answerRequestRef.current = request;
    setPendingAnswer(request);
    updateView((previous) => ({ ...previous, submitErrors: { ...previous.submitErrors, [questionId]: "" } }));
    try {
      const feedback = await submitAnswer(attemptId, questionId, answer, token);
      if (generationRef.current !== generation || answerRequestRef.current !== request) return;
      if (!isMatchingSubmission(feedback, attemptId, questionId)) {
        throw new Error("We could not confirm that this answer was saved. Please try again.");
      }
      confirmedQuestionsRef.current.add(questionId);
      updateView((previous) => ({
        ...previous, submitted: { ...previous.submitted, [questionId]: true },
        feedback: { ...previous.feedback, [questionId]: submissionFeedback(type, feedback) },
      }));
    } catch (error: unknown) {
      if (generationRef.current !== generation || answerRequestRef.current !== request) return;
      if (error instanceof ApiError && error.status === 401) { handleError(error); return; }
      if (error instanceof ApiError && error.status === 409) {
        // Reconcile only this answer. Reloading the whole view would erase other drafts.
        try {
          const latest = await getExam(attemptId, token);
          if (generationRef.current !== generation || answerRequestRef.current !== request) return;
          if (latest.attempt_id !== attemptId) throw new Error("Unexpected exam response.");
          const savedQuestion = latest.questions.find((question) => question.id === questionId);
          const saved = savedQuestion?.response;
          if (!savedQuestion || !saved?.is_submitted || saved.question_version_id !== questionId) {
            throw new Error("The server did not confirm a saved answer.");
          }
          confirmedQuestionsRef.current.add(questionId);
          updateView((previous) => ({
            ...previous,
            attempt: { ...previous.attempt, status: latest.status },
            submitted: { ...previous.submitted, [questionId]: true },
            selections: { ...previous.selections, [questionId]: saved.selected_option_ids ?? [] },
            texts: { ...previous.texts, [questionId]: saved.text_response ?? "" },
            feedback: { ...previous.feedback, [questionId]: submissionFeedback(type) },
            notices: { ...previous.notices, [questionId]: "This answer was already submitted. The saved response is shown below." },
            unsentDrafts: type === "essay" && saved.text_response !== textValue
              ? { ...previous.unsentDrafts, [questionId]: textValue }
              : previous.unsentDrafts,
          }));
          return;
        } catch (lookupError: unknown) {
          if (generationRef.current !== generation || answerRequestRef.current !== request) return;
          if (lookupError instanceof ApiError && lookupError.status === 401) { handleError(lookupError); return; }
          updateView((previous) => ({ ...previous, submitErrors: { ...previous.submitErrors,
            [questionId]: "We could not confirm the previously submitted answer. Your draft has not been replaced." } }));
          return;
        }
      }
      updateView((previous) => ({ ...previous, submitErrors: { ...previous.submitErrors, [questionId]:
        error instanceof Error ? error.message : "Unable to submit the answer." } }));
    } finally {
      if (answerRequestRef.current === request) { answerRequestRef.current = null; setPendingAnswer(null); }
    }
  }

  function handleViewResults() {
    if (usable && isAttemptSubmitted) router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
  }

  async function handleFinish(): Promise<void> {
    const generation = currentGeneration();
    if (!token || !generation || !editable || !progress.allQuestionsSubmitted || isSubmitting ||
        answerRequestRef.current || flagRequestRef.current || finishRequestRef.current) return;
    finishRequestRef.current = generation;
    setPendingFinish(generation);
    setFinishFailure(null);
    let navigating = false;
    try {
      const response = await submitExam(attemptId, token);
      if (generationRef.current !== generation || finishRequestRef.current !== generation) return;
      if (response.status !== "submitted" || response.attempt_id !== attemptId) {
        throw new Error("Unexpected final submission response.");
      }
      navigating = true;
      router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
    } catch (error: unknown) {
      if (generationRef.current !== generation || finishRequestRef.current !== generation) return;
      if (error instanceof ApiError && error.status === 401) { handleError(error); return; }
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await getExam(attemptId, token);
          if (generationRef.current !== generation || finishRequestRef.current !== generation) return;
          if (latest.attempt_id === attemptId && latest.status === "submitted") {
            navigating = true;
            router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
            return;
          }
        } catch (lookupError: unknown) {
          if (generationRef.current !== generation || finishRequestRef.current !== generation) return;
          if (lookupError instanceof ApiError && lookupError.status === 401) { handleError(lookupError); return; }
        }
        setFinishFailure({ scope, message: "Unable to finalize this attempt. Please try again." });
        return;
      }
      setFinishFailure({ scope, message: error instanceof Error ? error.message : "Unable to finish the exam." });
    } finally {
      if (finishRequestRef.current === generation && !navigating) {
        finishRequestRef.current = null;
        setPendingFinish(null);
      }
    }
  }

  return {
    ready, token, questions, currentQuestionIndex, goToQuestion, loadStatus,
    loadError: load?.scope === scope ? load.error : "", retryLoading,
    currentQuestion, isShortAnswer, isEssay, isTextAnswer, isMultiple,
    currentSelected, isSubmitted, isAttemptSubmitted,
    currentFeedback: view?.feedback[questionId], textValue, ...progress,
    isSubmitting, submitError: view?.submitErrors[questionId] ?? "",
    submissionNotice: view?.notices[questionId] ?? "",
    unsentDraft: view?.unsentDrafts[questionId], validationMessage,
    isFinishing, finishError: finishFailure?.scope === scope ? finishFailure.message : "",
    isFlagged, flaggedQuestionIds: questions.filter((q) => q.flagged_for_review === true).map((q) => q.id),
    flagPendingQuestionId: isSavingFlag ? (pendingFlag?.questionId ?? null) : null,
    isSavingFlag, flagError: view?.flagErrors[questionId] ?? "", canToggleFlag,
    handleToggleFlag, handleSelect, handleTextChange, handleSubmit, handleFinish, handleViewResults,
  };
}
