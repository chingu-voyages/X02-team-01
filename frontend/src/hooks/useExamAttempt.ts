"use client";

import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getExam, setQuestionFlag, submitAnswer } from "@/lib/exam-api";
import { saveExamDraft, saveExamPosition } from "@/lib/exam-recovery-api";
import { createRecoveryRevision, isRecoveryRevisionConflict, recoveryConflictMessage } from "@/lib/exam-recovery-revision";
import { createExamSaveQueue, type ExamSaveState } from "@/lib/exam-save-queue";
import { createRecoveryJournal, recoveryAccount, canRestoreRecoveryCopy, type RecoveryCopy } from "@/lib/exam-recovery-journal";
import { submitExam } from "@/lib/exam-submission";
import { deriveQuestionStates } from "@/lib/question-states";
import type {
  AnswerSubmission,
  ExamAttempt,
  ExamQuestionWithResponse,
  FeedbackEntry,
} from "@/types/exam-api.types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type LoadStatus = "loading" | "ready" | "error";
type FlagRequest = { attemptId: string; questionId: string };
type LoadScope = {
  id: string;
  token: string;
  reloadKey: number;
  status: ExamAttempt["status"] | null;
};
type SaveQueue = ReturnType<typeof createExamSaveQueue>;
type ScopedQueue = { id: string; token: string; reloadKey: number; queue: SaveQueue; revision: ReturnType<typeof createRecoveryRevision> };
type RecoveryScope = {
  attempt: ExamAttempt;
  token: string;
  journal: ReturnType<typeof createRecoveryJournal>;
  copies: RecoveryCopy[];
};
const idleSave: ExamSaveState = { status: "idle", pendingCount: 0, error: null };

export function useExamAttempt(attemptId: string) {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [storedQuestions, setQuestions] = useState<ExamQuestionWithResponse[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [storedLoadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAttempt, setLoadedAttempt] = useState<LoadScope | null>(null);

  const [selectedValuesMap, setSelectedValuesMap] = useState<Record<string, string[]>>({});
  const [textAnswersMap, setTextAnswersMap] = useState<Record<string, string>>({});
  const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackEntry>>({});
  // Update these only in event handlers or load completion, never inside a
  // React state updater. Rapid edits must not enqueue stale selections.
  const selectionsRef = useRef<Record<string, string[]>>({});
  const textRef = useRef<Record<string, string>>({});
  const positionRef = useRef(0);
  const submittedRef = useRef<Record<string, boolean>>({});
  const queueRef = useRef<ScopedQueue | null>(null);
  const [saveState, setSaveState] = useState<ExamSaveState>(idleSave);
  const recoveryRef = useRef<RecoveryScope | null>(null);
  const [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>([]);
  const [recoveryError, setRecoveryError] = useState("");
  const [deviceCopySaved, setDeviceCopySaved] = useState<boolean | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submittingRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const finishingRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [pendingFlag, setPendingFlag] = useState<FlagRequest | null>(null);
  const [flagErrors, setFlagErrors] = useState<Record<string, string>>({});
  const flagRequestRef = useRef<FlagRequest | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    let scopedQueue: ScopedQueue | null = null;
    let recovery: RecoveryScope | null = null;

    // A best-effort flush on backgrounding is NOT a confirmed durable save.
    function flushWhenHidden() {
      if (document.visibilityState === "hidden") void scopedQueue?.queue.flush();
    }
    function flushOnPageHide() { void scopedQueue?.queue.flush(); }
    function warnIfPending(event: BeforeUnloadEvent) {
      if (scopedQueue && (scopedQueue.queue.getState().pendingCount > 0 ||
          submittingRef.current || finishingRef.current || flagRequestRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    // Register beforeunload only while work is pending (see separate effect
    // below for submit/flag work). Avoid an always-on bfcache blocker.
    function syncUnloadWarning(pending: boolean) {
      if (pending) window.addEventListener("beforeunload", warnIfPending);
      else window.removeEventListener("beforeunload", warnIfPending);
    }

    getExam(attemptId, token)
      .then((data) => {
        if (cancelled) return;
        if (data.attempt_id !== attemptId) throw new Error("Unable to recover this exam. Please try again.");

        const restoredSubmitted: Record<string, boolean> = {};
        const restoredSelection: Record<string, string[]> = {};
        const restoredText: Record<string, string> = {};
        const restoredFeedback: Record<string, FeedbackEntry> = {};
        for (const question of data.questions) {
          const response = question.response;
          if (!response) continue;
          restoredSubmitted[question.id] = response.is_submitted;
          if (response.selected_option_ids) restoredSelection[question.id] = [...response.selected_option_ids];
          if (response.text_response) restoredText[question.id] = response.text_response;
          // Do not fabricate feedback or disclose an answer key on resume.
          if (typeof response.is_correct === "boolean") {
            restoredFeedback[question.id] = {
              feedback_released: false,
              is_correct: response.is_correct,
              correct_option_ids: [],
              explanation: null,
            };
          }
        }
        const restoredPosition = Math.max(0, Math.min(data.current_position - 1, data.questions.length - 1));
        selectionsRef.current = restoredSelection;
        textRef.current = restoredText;
        positionRef.current = restoredPosition;
        submittedRef.current = restoredSubmitted;
        submittingRef.current = false;
        finishingRef.current = false;
        setSaveState(idleSave);
        setDeviceCopySaved(null);
        setRecoveryCopies([]);
        setRecoveryError("");
        // Never inspect device answers until the server has authorized this
        // exact attempt. The JWT subject only namespaces the device copy.
        if (data.recovery_revision !== undefined) {
          try {
            const account = recoveryAccount(token);
            if (account) {
              const journal = createRecoveryJournal(window.localStorage, account, attemptId, window.crypto.randomUUID());
              const copies = journal.list(data);
              recovery = { attempt: data, token, journal, copies };
              recoveryRef.current = recovery;
              setRecoveryCopies(copies);
              if (journal.hasUnreadableCopies()) setRecoveryError("Some device copies could not be read. Your server-saved answers are unchanged.");
            }
          } catch {
            setRecoveryError("Device recovery is unavailable. Keep this page open until your progress is saved.");
          }
        }

        // Construct the queue only AFTER the authenticated GET succeeds.
        // Hydration itself does not send any draft/position writes.
        if (data.status === "in_progress") {
          const revision = createRecoveryRevision(data.recovery_revision);
          const queue: SaveQueue = createExamSaveQueue(
            async (operation, signal) => {
              const expected = revision.current();
              // Only the queue's confirmed response can advance this cursor.
              const saved = operation.kind === "draft"
                ? await (expected === undefined
                    ? saveExamDraft(attemptId, operation.questionVersionId, operation.answer, token, signal)
                    : saveExamDraft(attemptId, operation.questionVersionId, operation.answer, token, signal, expected))
                : await (expected === undefined
                    ? saveExamPosition(attemptId, operation.currentPosition, token, signal)
                    : saveExamPosition(attemptId, operation.currentPosition, token, signal, expected));
              revision.confirm(expected, saved?.recovery_revision);
            },
            {
              onStateChange: (next) => {
                if (cancelled) return;
                syncUnloadWarning(next.pendingCount > 0);
                const currentRevision = revision.current();
                const savedOnDevice = currentRevision !== undefined && recovery !== null &&
                  recovery.journal.save(currentRevision, queue.getPendingOperations());
                setDeviceCopySaved(next.pendingCount > 0 ? savedOnDevice : null);
                setSaveState(next);
              },
            },
          );
          scopedQueue = { id: attemptId, token, reloadKey, queue, revision };
          queueRef.current = scopedQueue;
          document.addEventListener("visibilitychange", flushWhenHidden);
          window.addEventListener("pagehide", flushOnPageHide);
        }

        setQuestions(data.questions);
        setLoadedAttempt({ id: attemptId, token, status: data.status, reloadKey });
        setPendingFlag(null);
        setFlagErrors({});
        setSubmittedMap(restoredSubmitted);
        setSelectedValuesMap(restoredSelection);
        setTextAnswersMap(restoredText);
        setFeedbackMap(restoredFeedback);
        setCurrentQuestionIndex(restoredPosition);
        setIsSubmitting(false);
        setIsFinishing(false);
        setIsLeaving(false);
        setLeaveError("");
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
        setLoadedAttempt({ id: attemptId, token, status: null, reloadKey });
        setLoadError(error instanceof ApiError && error.status === 404
          ? "We could not recover this exam. It may no longer be available."
          : error instanceof Error ? error.message : "Unable to load the exam.");
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
      scopedQueue?.queue.dispose();
      if (queueRef.current === scopedQueue) queueRef.current = null;
      if (recoveryRef.current === recovery) recoveryRef.current = null;
      flagRequestRef.current = null;
      window.removeEventListener("beforeunload", warnIfPending);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, [ready, token, attemptId, reloadKey, handleError]);

  const isCurrentLoad = Boolean(ready && token && loadedAttempt?.id === attemptId &&
    loadedAttempt.token === token && loadedAttempt.reloadKey === reloadKey);
  const loadStatus: LoadStatus = isCurrentLoad ? storedLoadStatus : "loading";
  const questions = loadStatus === "ready" ? storedQuestions : [];
  const isAttemptSubmitted = isCurrentLoad && loadedAttempt?.status === "submitted";
  const isActive = loadStatus === "ready" && loadedAttempt?.status === "in_progress";

  // Submission and flag operations may still be in flight after the draft
  // queue has become empty. Protect that interval too.
  useEffect(() => {
    if (!isCurrentLoad || !(isSubmitting || isFinishing || isLeaving || pendingFlag)) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isCurrentLoad, isSubmitting, isFinishing, isLeaving, pendingFlag]);

  function getQueue(): SaveQueue | null {
    const scoped = queueRef.current;
    return isActive && !recoveryRef.current?.copies.length && scoped && scoped.id === attemptId && scoped.token === token &&
      scoped.reloadKey === reloadKey ? scoped.queue : null;
  }

  function stillCurrent(queue: SaveQueue): boolean {
    return queueRef.current?.queue === queue;
  }

  function currentRecovery(): RecoveryScope | null {
    const scope = recoveryRef.current;
    return isCurrentLoad && scope?.token === token && scope.attempt.attempt_id === attemptId ? scope : null;
  }

  function reloadRecovery() {
    // Only the review screen may reload here, never an actively edited exam.
    if (!currentRecovery()?.copies.length) return;
    setLoadStatus("loading");
    setReloadKey((value) => value + 1);
  }

  function continueWithSavedProgress() {
    const scope = currentRecovery();
    if (!scope?.copies.length) return;
    scope.copies = [];
    setRecoveryCopies([]);
    setRecoveryError("");
  }

  function discardRecoveryCopy(key: string) {
    const scope = currentRecovery();
    const copy = scope?.copies.find((item) => item.key === key);
    if (!scope || !copy) return;
    try {
      if (!scope.journal.removeIfUnchanged(copy)) throw new Error("Changed device copy");
      scope.copies = scope.copies.filter((item) => item.key !== key);
      setRecoveryCopies(scope.copies);
      setRecoveryError("");
    } catch {
      setRecoveryError("This device copy changed or could not be removed. Reload saved progress to review it again.");
    }
  }

  function restoreRecoveryCopy(key: string) {
    const scope = currentRecovery();
    const copy = scope?.copies.find((item) => item.key === key);
    const scoped = queueRef.current;
    if (!scope || !copy || !scoped || scoped.id !== attemptId || scoped.token !== token ||
        scoped.reloadKey !== reloadKey || !isActive || scoped.queue.getState().pendingCount !== 0 ||
        scoped.revision.current() !== copy.revision || !canRestoreRecoveryCopy(copy, scope.attempt)) return;
    try {
      if (!scope.journal.isUnchanged(copy)) throw new Error("Changed device copy");
    } catch {
      setRecoveryError("This device copy changed or could not be read. Reload saved progress to review it again.");
      return;
    }
    // Restore only an explicitly chosen, still-valid snapshot. Leave other
    // tabs' copies untouched. The server revision precondition still applies
    // even if another client changes progress after this check.
    const selections = { ...selectionsRef.current };
    const texts = { ...textRef.current };
    let index = positionRef.current;
    for (const operation of copy.operations) {
      if (operation.kind === "position") index = operation.currentPosition - 1;
      else {
        selections[operation.questionVersionId] = [...(operation.answer.selected_option_ids ?? [])];
        texts[operation.questionVersionId] = operation.answer.text_response ?? "";
      }
    }
    selectionsRef.current = selections;
    textRef.current = texts;
    positionRef.current = index;
    setSelectedValuesMap(selections);
    setTextAnswersMap(texts);
    setCurrentQuestionIndex(index);
    scope.copies = [];
    setRecoveryCopies([]);
    setRecoveryError("");
    for (const operation of copy.operations) scoped.queue.enqueue(operation);
    // Copy-before-delete: if storage is full, keep the original snapshot.
    if (scope.journal.save(copy.revision, scoped.queue.getPendingOperations())) {
      try { scope.journal.removeIfUnchanged(copy); } catch { /* original is safe to retain */ }
    }
    void scoped.queue.flush();
  }

  function retryLoading() {
    // Only the failed-load screen may retry. Never silently discard edits.
    if (loadStatus !== "error") return;
    setLoadStatus("loading");
    setLoadError("");
    setReloadKey((value) => value + 1);
  }

  const currentQuestion = questions[currentQuestionIndex];
  const questionId = currentQuestion?.id ?? "";
  const isShortAnswer = currentQuestion?.question_type === "short_answer";
  const isMultiple = currentQuestion?.allows_multiple_answers ?? false;
  const currentSelected = selectedValuesMap[questionId] || [];
  const isSubmitted = isAttemptSubmitted || (submittedMap[questionId] || false);
  const currentFeedback = feedbackMap[questionId];
  const textValue = textAnswersMap[questionId] ?? "";
  const { questionStates, submittedCount, remainingCount, allQuestionsSubmitted, firstUnsubmittedIndex } = deriveQuestionStates({
    questions, currentQuestionIndex, submittedMap, selectedValuesMap, textAnswersMap,
  });

  const isFlagged = currentQuestion?.flagged_for_review === true;
  const flaggedQuestionIds = questions.filter((question) => question.flagged_for_review === true).map((question) => question.id);
  const flagPendingQuestionId = isCurrentLoad && pendingFlag?.attemptId === attemptId ? pendingFlag.questionId : null;
  const isSavingFlag = flagPendingQuestionId !== null;
  const flagError = flagErrors[questionId] ?? "";
  const canToggleFlag = Boolean(isActive && currentQuestion && !isSavingFlag && !isSubmitting && !isFinishing && !isLeaving);

  const activeSaveState = isCurrentLoad ? saveState : idleSave;
  const saveErrorStatus = activeSaveState.error instanceof ApiError ? activeSaveState.error.status : null;
  const canRetrySave = isActive && activeSaveState.status === "error" && ![401, 403, 404, 409].includes(saveErrorStatus ?? 0);
  const saveErrorMessage = isRecoveryRevisionConflict(activeSaveState.error)
    ? recoveryConflictMessage
    : saveErrorStatus === 401
    ? "Your session expired. Keep this page open and copy any unsaved text before signing in again."
    : saveErrorStatus === 403 || saveErrorStatus === 404
      ? "This exam is no longer available to save. Keep this page open and copy any unsaved text."
      : saveErrorStatus === 409
        ? "This exam changed or was submitted elsewhere. Your unsaved changes remain on this page. Copy any unfinished text before reloading."
        : saveErrorStatus === 422
          ? "A draft was rejected. Check the answer (written responses are limited to 10,000 characters) and retry."
          : "Your latest changes are still on this page. Check your connection and retry before leaving.";

  const canReviewDeviceCopy = isActive && deviceCopySaved === true &&
    activeSaveState.status === "error" && saveErrorStatus === 409 && !isSubmitting && !isFinishing && !isLeaving;

  function reviewDeviceCopy() {
    const queue = getQueue();
    const scope = currentRecovery();
    const revision = queueRef.current?.revision.current();
    if (!canReviewDeviceCopy || !queue || !scope || revision === undefined ||
        submittingRef.current || finishingRef.current || flagRequestRef.current) return;
    if (!scope.journal.save(revision, queue.getPendingOperations())) {
      setDeviceCopySaved(false);
      setLeaveError("Unable to protect the device copy. Keep this page open and copy any unsaved answers.");
      return;
    }
    setLoadStatus("loading");
    setReloadKey((value) => value + 1);
  }

  function retrySave() {
    const queue = getQueue();
    if (queue && canRetrySave && !submittingRef.current && !finishingRef.current) {
      setLeaveError("");
      void queue.retry();
    }
  }

  function goToQuestion(index: number): boolean {
    const queue = getQueue();
    if (!queue || submittingRef.current || finishingRef.current || isSubmitting || isFinishing ||
        !Number.isInteger(index) || index < 0 || index >= questions.length) return false;
    if (index !== positionRef.current) {
      positionRef.current = index;
      setCurrentQuestionIndex(index);
      setSubmitError("");
      queue.enqueue({ kind: "position", currentPosition: index + 1 });
      // Navigation is an explicit save opportunity, not a submission.
      void queue.flush();
    }
    return true;
  }

  async function handleToggleFlag(): Promise<void> {
    const queue = getQueue();
    if (!queue || !token || !canToggleFlag || !questionId || flagRequestRef.current ||
        submittingRef.current || finishingRef.current) return;
    const request = { attemptId, questionId };
    const desiredFlag = !isFlagged;
    flagRequestRef.current = request;
    setPendingFlag(request);
    setFlagErrors((previous) => ({ ...previous, [questionId]: "" }));
    try {
      const saved = await setQuestionFlag(attemptId, questionId, desiredFlag, token);
      if (!stillCurrent(queue) || flagRequestRef.current !== request) return;
      if (!saved || saved.attempt_id !== attemptId || saved.question_version_id !== questionId ||
          saved.flagged_for_review !== desiredFlag) throw new Error("Unexpected flag response. Please try again.");
      setQuestions((previous) => previous.map((question) => question.id === request.questionId
        ? { ...question, flagged_for_review: saved.flagged_for_review } : question));
    } catch (error: unknown) {
      if (!stillCurrent(queue) || flagRequestRef.current !== request) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setFlagErrors((previous) => ({ ...previous, [questionId]: error instanceof ApiError && error.status === 409
        ? "This exam has already been submitted. Flags can no longer be changed."
        : error instanceof Error ? error.message : "Unable to save the review flag. Please try again." }));
      if (error instanceof ApiError && error.status === 409) {
        // Do not silently dispose pending draft edits. A separate recovery
        // message remains visible if a queued write fails against this attempt.
        setLoadedAttempt({ id: attemptId, token, status: "submitted", reloadKey });
      }
    } finally {
      if (flagRequestRef.current === request) {
        flagRequestRef.current = null;
        setPendingFlag(null);
      }
    }
  }

  function handleSelect(optionId: string) {
    const queue = getQueue();
    if (!queue || !currentQuestion || isShortAnswer || isSubmitted || isSubmitting || isFinishing ||
        submittingRef.current || finishingRef.current || submittedRef.current[questionId] || positionRef.current !== currentQuestionIndex ||
        !currentQuestion.options.some((option) => option.id === optionId)) return;
    const existing = selectionsRef.current[questionId] || [];
    const updated = isMultiple ? (existing.includes(optionId) ? existing.filter((id) => id !== optionId) : [...existing, optionId]) : [optionId];
    if (!isMultiple && existing[0] === optionId) return;
    selectionsRef.current = { ...selectionsRef.current, [questionId]: updated };
    setSelectedValuesMap(selectionsRef.current);
    queue.enqueue({ kind: "draft", questionVersionId: questionId,
      answer: { selected_option_ids: updated.length ? updated : null, text_response: null } });
  }

  function handleTextChange(value: string) {
    const queue = getQueue();
    if (!queue || !currentQuestion || !isShortAnswer || isSubmitted || isSubmitting || isFinishing ||
        submittingRef.current || finishingRef.current || submittedRef.current[questionId] || positionRef.current !== currentQuestionIndex) return;
    if ((textRef.current[questionId] ?? "") === value) return;
    textRef.current = { ...textRef.current, [questionId]: value };
    setTextAnswersMap(textRef.current);
    queue.enqueue({ kind: "draft", questionVersionId: questionId,
      answer: { selected_option_ids: null, text_response: value.trim() ? value : null } });
  }

  function handleSubmit() {
    const queue = getQueue();
    if (!queue || !token || !currentQuestion || isSubmitting || isSubmitted || isFinishing ||
        submittingRef.current || finishingRef.current || submittedRef.current[questionId] || flagRequestRef.current || positionRef.current !== currentQuestionIndex) return;
    const answer: AnswerSubmission = isShortAnswer
      ? { selected_option_ids: null, text_response: textRef.current[questionId]?.trim() || null }
      : { selected_option_ids: [...(selectionsRef.current[questionId] ?? [])], text_response: null };
    if (!answer.text_response && !(answer.selected_option_ids && answer.selected_option_ids.length > 0)) {
      setSubmitError("Choose an answer before submitting.");
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError("");
    void (async () => {
      try {
        // A pending PUT must never arrive after a successful POST lock.
        if (queue.getState().pendingCount > 0 && !await queue.flush()) {
          if (stillCurrent(queue)) setSubmitError("Save your progress before submitting this answer.");
          return;
        }
        if (!stillCurrent(queue)) return;
        const revision = queueRef.current?.revision;
        const expected = revision?.current();
        const feedback = await submitAnswer(attemptId, questionId,
          expected === undefined ? answer : { ...answer, expected_revision: expected }, token);
        if (!stillCurrent(queue)) return;
        revision?.confirm(expected, feedback.recovery_revision);
        setFeedbackMap((previous) => ({ ...previous, [questionId]: {
          feedback_released: feedback.feedback_released,
          is_correct: feedback.feedback_released && typeof feedback.is_correct === "boolean" ? feedback.is_correct : null,
          correct_option_ids: feedback.feedback_released ? (feedback.correct_option_ids ?? []) : [],
          explanation: feedback.feedback_released ? (feedback.explanation ?? null) : null,
        } }));
        submittedRef.current = { ...submittedRef.current, [questionId]: true };
        setSubmittedMap(submittedRef.current);
      } catch (error: unknown) {
        if (!stillCurrent(queue)) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        if (isRecoveryRevisionConflict(error)) {
          setSubmitError(recoveryConflictMessage);
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          // All drafts are confirmed before submission, so reloading is safe.
          setSubmitError("This question was already submitted. Reloading...");
          setReloadKey((value) => value + 1);
          return;
        }
        setSubmitError(error instanceof Error ? error.message : "Unable to submit the answer.");
      } finally {
        if (stillCurrent(queue)) {
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    })();
  }

  async function handleFinish() {
    const queue = getQueue();
    if (!queue || !token || !allQuestionsSubmitted || isSubmitting || submittingRef.current ||
        flagRequestRef.current || finishingRef.current) return;
    finishingRef.current = true;
    setIsFinishing(true);
    setFinishError("");
    let navigating = false;
    try {
      if (queue.getState().pendingCount > 0 && !await queue.flush()) {
        if (stillCurrent(queue)) setFinishError("Save your progress before finishing the exam.");
        return;
      }
      if (!stillCurrent(queue)) return;
      const revision = queueRef.current?.revision;
      const expected = revision?.current();
      const response = await (expected === undefined ? submitExam(attemptId, token) : submitExam(attemptId, token, expected));
      if (!stillCurrent(queue)) return;
      revision?.confirm(expected, response.recovery_revision);
      if (response.status !== "submitted" || response.attempt_id !== attemptId) throw new Error("Unexpected final submission response.");
      navigating = true;
      // Keep the finish action locked until the results route unmounts us.
      router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
    } catch (error: unknown) {
      if (!stillCurrent(queue)) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      if (isRecoveryRevisionConflict(error)) {
        setFinishError(recoveryConflictMessage);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        try {
          const current = await getExam(attemptId, token);
          if (!stillCurrent(queue)) return;
          if (current.attempt_id === attemptId && current.status === "submitted") {
            navigating = true;
            router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
            return;
          }
        } catch (lookupError: unknown) {
          if (!stillCurrent(queue)) return;
          if (lookupError instanceof ApiError && lookupError.status === 401) {
            handleError(lookupError);
            return;
          }
        }
        setFinishError("Unable to finalize this attempt. Please try again.");
        return;
      }
      setFinishError(error instanceof Error ? error.message : "Unable to finish the exam.");
    } finally {
      if (!navigating && stillCurrent(queue)) {
        finishingRef.current = false;
        setIsFinishing(false);
      }
    }
  }

  const canSaveAndLeave = isActive && !isSubmitting && !isFinishing && !isSavingFlag && !isLeaving;

  // Leaving is not final submission. Freeze all exam edits while flushing,
  // and navigate only after the server acknowledges every pending write.
  async function handleSaveAndLeave() {
    const queue = getQueue();
    if (!queue || !canSaveAndLeave || submittingRef.current || finishingRef.current || flagRequestRef.current) return;
    finishingRef.current = true;
    setIsLeaving(true);
    setLeaveError("");
    let navigating = false;
    try {
      const state = queue.getState();
      const saved = state.status === "error" && canRetrySave ? await queue.retry() : await queue.flush();
      if (!stillCurrent(queue)) return;
      if (!saved || queue.getState().pendingCount > 0) {
        setLeaveError("Your changes are not saved yet. Stay here and resolve the save issue before leaving.");
        return;
      }
      router.replace("/categories");
      navigating = true;
    } catch {
      if (stillCurrent(queue)) setLeaveError("Unable to leave safely. Please try again.");
    } finally {
      if (!navigating && stillCurrent(queue)) {
        finishingRef.current = false;
        setIsLeaving(false);
      }
    }
  }

  function backToPracticeExams() {
    if (loadStatus === "error" || (isAttemptSubmitted && saveState.pendingCount === 0)) {
      router.replace("/categories");
    }
  }

  function viewResults() {
    if (isAttemptSubmitted && saveState.pendingCount === 0) router.replace(`/exams/${encodeURIComponent(attemptId)}/results`);
  }

  return {
    ready, token, questions, currentQuestionIndex, goToQuestion, loadStatus, loadError, retryLoading,
    currentQuestion, isShortAnswer, isMultiple, currentSelected, isSubmitted, currentFeedback, textValue,
    questionStates, submittedCount, remainingCount, allQuestionsSubmitted, firstUnsubmittedIndex,
    isSubmitting, submitError, isFinishing, finishError, isFlagged, flaggedQuestionIds,
    flagPendingQuestionId, isSavingFlag, flagError, canToggleFlag, handleToggleFlag, handleSelect,
    handleTextChange, handleSubmit, handleFinish, saveState: isCurrentLoad ? saveState : idleSave,
    canRetrySave, saveErrorMessage, retrySave, isAttemptSubmitted, viewResults,
    isLeaving, canSaveAndLeave, handleSaveAndLeave, leaveError, backToPracticeExams,
    recoveryCopies: loadStatus === "ready" ? recoveryCopies : [],
    recoveryError: isCurrentLoad ? recoveryError : "",
    deviceCopySaved: loadStatus === "ready" ? deviceCopySaved : null,
    restoreRecoveryCopy, discardRecoveryCopy, continueWithSavedProgress, reloadRecovery,
    canReviewDeviceCopy, reviewDeviceCopy,
  };
}
