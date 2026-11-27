"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";
import BrowseExamCard, { type ExamCardVariant } from "./BrowseExamCard";
import ExamFilterBar from "./ExamFilterBar";
import ExamSelectionStatus from "./ExamSelectionStatus";
import PageHero from "./PageHero";
import {
  getExamAvailabilityIssue,
  getExamStartIssue,
  type ExamStartIssue,
} from "./examAvailability";

type LoadStatus = "loading" | "ready" | "error";
type ResumeState = { token: string; attempts: Record<string, string> };
type StartIssueState = { token: string; issues: Record<string, ExamStartIssue> };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getExistingAttemptId(detail: unknown): string | null {
  if (
    detail === null ||
    typeof detail !== "object" ||
    !("code" in detail) ||
    detail.code !== "ATTEMPT_IN_PROGRESS" ||
    !("attempt_id" in detail) ||
    typeof detail.attempt_id !== "string"
  ) {
    return null;
  }

  return uuidPattern.test(detail.attempt_id) ? detail.attempt_id : null;
}

function getCardVariant(index: number): ExamCardVariant {
  if (index === 0) return "featured";
  return index % 2 === 1 ? "standard" : "alt";
}

export default function PracticeExamsScreen() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [exams, setExams] = useState<PublishedPracticeExam[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [certificationFilter, setCertificationFilter] = useState("all");
  const [startingExamId, setStartingExamId] = useState<string | null>(null);
  const [startIssueState, setStartIssueState] = useState<StartIssueState | null>(null);
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;
    getPublishedPracticeExams(token)
      .then((data) => {
        if (cancelled) return;

        setExams(data);
        // A refresh may remove the last exam for the selected certification.
        setCertificationFilter((current) =>
          current === "all" || data.some((exam) => exam.certification_id === current)
            ? current
            : "all",
        );
        setLoadStatus("ready");
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }

        setLoadError("We could not load practice exams. Check your connection and try again.");
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, reloadKey, handleError]);

  const certifications = Array.from(
    new Map(
      exams.map((exam) => [
        exam.certification_id,
        { id: exam.certification_id, name: exam.certification_name },
      ]),
    ).values(),
  );

  const visibleExams = exams.filter(
    (exam) => certificationFilter === "all" || exam.certification_id === certificationFilter,
  );
  const resumeAttempts: Record<string, string> =
    resumeState && resumeState.token === token ? resumeState.attempts : {};
  const startIssues: Record<string, ExamStartIssue> =
    startIssueState && startIssueState.token === token ? startIssueState.issues : {};
  const isStarting = startingExamId !== null;

  function isAvailable(exam: PublishedPracticeExam) {
    return Boolean(resumeAttempts[exam.id]) ||
      (!getExamAvailabilityIssue(exam) && !startIssues[exam.id]?.requiresReload);
  }

  function reloadExams() {
    if (startingRef.current) return;
    setLoadStatus("loading");
    setLoadError("");
    setStartIssueState(null);
    setResumeState(null);
    setReloadKey((value) => value + 1);
  }

  async function handleStartExam(exam: PublishedPracticeExam) {
    if (
      !token || startingRef.current || resumeAttempts[exam.id] ||
      !isAvailable(exam)
    ) return;

    // Prevent multiple card actions before React has rendered disabled controls.
    startingRef.current = true;
    setStartingExamId(exam.id);
    setStartIssueState((previous) => {
      if (previous?.token !== token) return null;
      const issues = { ...previous.issues };
      delete issues[exam.id];
      return { token, issues };
    });

    try {
      const attempt = await startPublishedPracticeExam(token, exam);
      router.push(`/exams/${encodeURIComponent(attempt.attempt_id)}`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }

      if (error instanceof ApiError && error.status === 409) {
        const attemptId = getExistingAttemptId(error.detail);
        if (attemptId) {
          // A resume ID belongs to the exact requested exam and session.
          setResumeState((previous) => ({
            token,
            attempts: {
              ...(previous && previous.token === token ? previous.attempts : {}),
              [exam.id]: attemptId,
            },
          }));
          return;
        }
      }

      setStartIssueState((previous) => ({
        token,
        issues: {
          ...(previous && previous.token === token ? previous.issues : {}),
          [exam.id]: getExamStartIssue(error),
        },
      }));
    } finally {
      startingRef.current = false;
      setStartingExamId(null);
    }
  }

  function continueExam(examId: string) {
    if (!token || startingRef.current) return;
    const attemptId = resumeAttempts[examId];
    if (!attemptId) return;
    router.push(`/exams/${encodeURIComponent(attemptId)}`);
  }

  if (!ready || !token) {
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Checking session...
      </p>
    );
  }

  return (
    <section className="min-w-0 space-y-4 sm:space-y-6">
      <PageHero
        eyebrow="Practice exams"
        title="Select a practice exam"
        description="Choose a published practice exam. Each card shows its question count, and questions are drawn from the approved bank."
      />

      <fieldset disabled={isStarting || loadStatus !== "ready"} className="min-w-0">
        <ExamFilterBar
          certifications={certifications}
          selectedCertificationId={certificationFilter}
          totalExamCount={exams.length}
          visibleExamCount={visibleExams.filter(isAvailable).length}
          onSelectAll={() => setCertificationFilter("all")}
          onSelectCertification={setCertificationFilter}
        />
      </fieldset>

      <ExamSelectionStatus
        loadStatus={loadStatus}
        loadError={loadError}
        totalExamCount={exams.length}
        visibleExamCount={visibleExams.length}
        onRetryLoad={reloadExams}
      />

      {loadStatus === "ready" && visibleExams.length > 0 && (
        <section
          aria-label="Available practice exams"
          aria-busy={isStarting}
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3 sm:gap-6"
        >
          {visibleExams.map((exam, index) => (
            <BrowseExamCard
              key={exam.id}
              exam={exam}
              variant={getCardVariant(index)}
              iconIndex={index}
              isStarting={startingExamId === exam.id}
              disabled={isStarting}
              startIssue={startIssues[exam.id]}
              onReload={reloadExams}
              onStartExam={handleStartExam}
              onContinueExam={
                resumeAttempts[exam.id] ? () => continueExam(exam.id) : undefined
              }
            />
          ))}
        </section>
      )}
    </section>
  );
}
