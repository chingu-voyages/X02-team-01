"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getPublishedPracticeExams, startPublishedPracticeExam } from "@/lib/practice-exam-api";
import { getUnfinishedExamAttempts, type UnfinishedExam } from "@/lib/unfinished-exams-api";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";
import BrowseExamCard, { type ExamCardVariant } from "./BrowseExamCard";
import ExamFilterBar from "./ExamFilterBar";
import ExamSelectionStatus from "./ExamSelectionStatus";
import PageHero from "./PageHero";
import UnfinishedExamCard from "./UnfinishedExamCard";
import { getExamAvailabilityIssue, getExamStartIssue, type ExamStartIssue } from "./examAvailability";

type LoadStatus = "loading" | "ready" | "error";
type CatalogScope = { token: string; reloadKey: number };
type CatalogState = CatalogScope & { exams: PublishedPracticeExam[]; failed: boolean };
type UnfinishedState = CatalogScope & { attempts: UnfinishedExam[]; failed: boolean };
type ResumeState = { token: string; attempts: Record<string, string> };
type StartIssueState = { token: string; issues: Record<string, ExamStartIssue> };
type StartRequest = { token: string; examId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getExistingAttemptId(detail: unknown): string | null {
  if (
    detail === null || typeof detail !== "object" || !("code" in detail) ||
    detail.code !== "ATTEMPT_IN_PROGRESS" || !("attempt_id" in detail) ||
    typeof detail.attempt_id !== "string"
  ) return null;
  return uuidPattern.test(detail.attempt_id) ? detail.attempt_id : null;
}

function getCardVariant(index: number): ExamCardVariant {
  if (index === 0) return "featured";
  return index % 2 === 1 ? "standard" : "alt";
}

export default function PracticeExamsScreen() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();
  const [catalogState, setCatalogState] = useState<CatalogState | null>(null);
  const [unfinishedState, setUnfinishedState] = useState<UnfinishedState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [certificationFilter, setCertificationFilter] = useState("all");
  const [startingRequest, setStartingRequest] = useState<StartRequest | null>(null);
  const [startIssueState, setStartIssueState] = useState<StartIssueState | null>(null);
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);
  const startingRef = useRef<StartRequest | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    let expired = false;
    function reportExpired(error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        if (!expired) {
          expired = true;
          handleError(error);
        }
        return true;
      }
      return false;
    }

    // Fetch independently. Recovery may succeed even if the new-attempt
    // catalog is down; never present an unfinished exam as a new attempt.
    void getUnfinishedExamAttempts(token).then((attempts) => {
      if (cancelled || expired) return;
      setUnfinishedState({ token, reloadKey, attempts, failed: false });
    }).catch((error: unknown) => {
      if (cancelled || reportExpired(error) || expired) return;
      setUnfinishedState({ token, reloadKey, attempts: [], failed: true });
    });

    void getPublishedPracticeExams(token).then((exams) => {
      if (cancelled || expired) return;
      setCatalogState({ token, reloadKey, exams, failed: false });
      if (!startingRef.current) setStartingRequest(null);
      // Conflict hints remain useful if discovery fails, but a new visit
      // should not carry stale IDs or stale configuration errors.
      setResumeState(null);
      setStartIssueState(null);
      setCertificationFilter((current) => current === "all" || exams.some((exam) => exam.certification_id === current) ? current : "all");
    }).catch((error: unknown) => {
      if (cancelled || reportExpired(error) || expired) return;
      setCatalogState({ token, reloadKey, exams: [], failed: true });
      if (!startingRef.current) setStartingRequest(null);
    });

    return () => {
      cancelled = true;
      // Ignore late Start responses after switching account or leaving.
      if (startingRef.current?.token === token) startingRef.current = null;
    };
  }, [ready, token, reloadKey, handleError]);

  const catalogCurrent = catalogState !== null && catalogState.token === token && catalogState.reloadKey === reloadKey;
  const recoveryCurrent = unfinishedState !== null && unfinishedState.token === token && unfinishedState.reloadKey === reloadKey;
  const unfinished = recoveryCurrent ? unfinishedState.attempts : [];
  const unfinishedFailed = recoveryCurrent && unfinishedState.failed;
  // Wait for recovery discovery (or its explicit failure) before offering
  // Start actions. The recovery cards themselves can display immediately.
  const loadStatus: LoadStatus = !catalogCurrent ? "loading" : catalogState.failed ? "error" : recoveryCurrent ? "ready" : "loading";
  const exams = catalogCurrent ? catalogState.exams : [];
  const activeExamIds = new Set(unfinished.map((attempt) => attempt.practice_exam_id));
  const newExams = loadStatus === "ready" ? exams.filter((exam) => !activeExamIds.has(exam.id)) : [];
  const certifications = Array.from(new Map(newExams.map((exam) => [
    exam.certification_id, { id: exam.certification_id, name: exam.certification_name },
  ])).values());
  const effectiveFilter = certificationFilter === "all" || certifications.some((cert) => cert.id === certificationFilter) ? certificationFilter : "all";
  const visibleExams = newExams.filter((exam) => effectiveFilter === "all" || exam.certification_id === effectiveFilter);
  const resumeAttempts: Record<string, string> = resumeState && resumeState.token === token ? resumeState.attempts : {};
  const startIssues: Record<string, ExamStartIssue> = startIssueState && startIssueState.token === token ? startIssueState.issues : {};
  const startingExamId = startingRequest && startingRequest.token === token ? startingRequest.examId : null;
  const isStarting = startingExamId !== null;

  function isAvailable(exam: PublishedPracticeExam) {
    return Boolean(resumeAttempts[exam.id]) || (!getExamAvailabilityIssue(exam) && !startIssues[exam.id]?.requiresReload);
  }

  function reloadExams() {
    if (startingRef.current) return;
    setResumeState(null);
    setStartIssueState(null);
    setReloadKey((value) => value + 1);
  }

  async function handleStartExam(exam: PublishedPracticeExam) {
    if (!token || loadStatus !== "ready" || startingRef.current || activeExamIds.has(exam.id) || resumeAttempts[exam.id] || !isAvailable(exam)) return;
    const request = { token, examId: exam.id };
    startingRef.current = request;
    setStartingRequest(request);
    setStartIssueState((previous) => {
      if (previous?.token !== token) return null;
      const issues = { ...previous.issues };
      delete issues[exam.id];
      return { token, issues };
    });
    try {
      const attempt = await startPublishedPracticeExam(token, exam);
      if (startingRef.current !== request) return;
      router.push(`/exams/${encodeURIComponent(attempt.attempt_id)}`);
    } catch (error: unknown) {
      if (startingRef.current !== request) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        const attemptId = getExistingAttemptId(error.detail);
        if (attemptId) {
          // Race or discovery outage: server-confirmed exact-exam fallback.
          setResumeState((previous) => ({ token, attempts: {
            ...(previous?.token === token ? previous.attempts : {}), [exam.id]: attemptId,
          } }));
          return;
        }
      }
      setStartIssueState((previous) => ({ token, issues: {
        ...(previous?.token === token ? previous.issues : {}), [exam.id]: getExamStartIssue(error),
      } }));
    } finally {
      if (startingRef.current === request) {
        startingRef.current = null;
        setStartingRequest(null);
      }
    }
  }

  function continueSavedAttempt(attemptId: string) {
    if (!token || startingRef.current || !unfinished.some((attempt) => attempt.attempt_id === attemptId)) return;
    router.push(`/exams/${encodeURIComponent(attemptId)}`);
  }

  function continueExam(examId: string) {
    if (!token || startingRef.current) return;
    const attemptId = resumeAttempts[examId];
    if (!attemptId) return;
    // Consume only this fallback hint. A later visit re-queries the server.
    setResumeState((previous) => {
      if (previous?.token !== token) return previous;
      const attempts = { ...previous.attempts };
      delete attempts[examId];
      return { token, attempts };
    });
    router.push(`/exams/${encodeURIComponent(attemptId)}`);
  }

  if (!ready || !token) {
    return <p role="status" className="text-sm text-brand-text/70">Checking session...</p>;
  }

  return (
    <section className="min-w-0 space-y-4 sm:space-y-6">
      <PageHero eyebrow="Practice exams" title="Select a practice exam"
        description="Continue an unfinished exam or choose a new published practice exam from the approved question bank." />

      {unfinished.length > 0 && (
        <section aria-labelledby="unfinished-exams-title" className="min-w-0 space-y-3">
          <div>
            <h2 id="unfinished-exams-title" className="text-lg font-bold text-brand-text sm:text-xl">Continue learning</h2>
            <p className="text-sm text-brand-text/75">Pick up where you left off. Your original questions and answers are kept.</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {unfinished.map((attempt) => (
              <UnfinishedExamCard key={attempt.attempt_id} attempt={attempt} disabled={isStarting}
                onContinue={() => continueSavedAttempt(attempt.attempt_id)} />
            ))}
          </div>
        </section>
      )}
      {unfinishedFailed && (
        <div role="alert" className="flex min-w-0 flex-col gap-2 rounded-xl border border-amber-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 wrap-anywhere text-sm text-brand-text">We could not load your unfinished exams. Try again to see your saved progress.</p>
          <button type="button" onClick={reloadExams} disabled={isStarting} className="min-h-11 w-full rounded-full border border-brand-border px-4 text-sm font-semibold text-brand-primary hover:bg-brand-surface sm:w-auto">Retry loading unfinished exams</button>
        </div>
      )}
      {loadStatus === "ready" && exams.length > 0 && newExams.length === 0 ? (
        <p role="status" className="rounded-xl border border-brand-border bg-white p-4 text-sm text-brand-text">You have unfinished attempts for all currently available practice exams.</p>
      ) : (
        <>
          {unfinished.length > 0 && newExams.length > 0 && <h2 className="text-lg font-bold text-brand-text sm:text-xl">Start a new exam</h2>}
          <fieldset disabled={isStarting || loadStatus !== "ready"} className="min-w-0">
            <ExamFilterBar certifications={certifications} selectedCertificationId={effectiveFilter}
              totalExamCount={newExams.length} visibleExamCount={visibleExams.filter(isAvailable).length}
              onSelectAll={() => setCertificationFilter("all")} onSelectCertification={setCertificationFilter} />
          </fieldset>
          <ExamSelectionStatus loadStatus={loadStatus}
            loadError="We could not load practice exams. Check your connection and try again."
            totalExamCount={newExams.length} visibleExamCount={visibleExams.length} onRetryLoad={reloadExams} />
          {loadStatus === "ready" && visibleExams.length > 0 && (
            <section aria-label="Available practice exams" aria-busy={isStarting}
              className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3 sm:gap-6">
              {visibleExams.map((exam, index) => (
                <BrowseExamCard key={exam.id} exam={exam} variant={getCardVariant(index)} iconIndex={index}
                  isStarting={startingExamId === exam.id} disabled={isStarting} startIssue={startIssues[exam.id]}
                  onReload={reloadExams} onStartExam={handleStartExam}
                  onContinueExam={resumeAttempts[exam.id] ? () => continueExam(exam.id) : undefined} />
              ))}
            </section>
          )}
        </>
      )}
    </section>
  );
}
