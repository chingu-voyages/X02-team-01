"use client";

import { useEffect, useState } from "react";
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

type LoadStatus = "loading" | "ready" | "error";

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
  const [startError, setStartError] = useState("");
  const [existingAttemptId, setExistingAttemptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;
    getPublishedPracticeExams(token)
      .then((data) => {
        if (cancelled) return;

        setExams(data);
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
          error instanceof Error
            ? error.message
            : "Unable to load practice exams.",
        );
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
    (exam) =>
      certificationFilter === "all" ||
      exam.certification_id === certificationFilter,
  );

  function clearStartState() {
    setStartError("");
    setExistingAttemptId(null);
  }

  function reloadExams() {
    setLoadStatus("loading");
    setLoadError("");
    clearStartState();
    setReloadKey((value) => value + 1);
  }

  async function handleStartExam(exam: PublishedPracticeExam) {
    if (!token || startingExamId !== null) return;

    setStartingExamId(exam.id);
    clearStartState();

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
          setExistingAttemptId(attemptId);
          setStartError(
            "You already have an unfinished exam for this certification.",
          );
        } else {
          setStartError(
            "This practice exam is no longer available as shown. Reload the list and try again.",
          );
        }
        return;
      }

      setStartError(
        error instanceof Error
          ? error.message
          : "Unable to start practice exam.",
      );
    } finally {
      setStartingExamId(null);
    }
  }

  function continueExistingExam() {
    if (!existingAttemptId) return;
    router.push(`/exams/${encodeURIComponent(existingAttemptId)}`);
  }

  if (!ready || !token) {
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Checking session...
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <PageHero
        eyebrow="Practice exams"
        title="Select a practice exam"
        description="Choose a certification or category. Questions are selected from the approved question bank each time you start."
      />

      <ExamFilterBar
        certifications={certifications}
        selectedCertificationId={certificationFilter}
        totalExamCount={exams.length}
        visibleExamCount={visibleExams.length}
        onSelectAll={() => {
          setCertificationFilter("all");
          clearStartState();
        }}
        onSelectCertification={(certificationId) => {
          setCertificationFilter(certificationId);
          clearStartState();
        }}
      />

      <ExamSelectionStatus
        loadStatus={loadStatus}
        loadError={loadError}
        totalExamCount={exams.length}
        visibleExamCount={visibleExams.length}
        startError={startError}
        existingAttemptId={existingAttemptId}
        onRetryLoad={reloadExams}
        onContinueExisting={continueExistingExam}
      />

      {loadStatus === "ready" && visibleExams.length > 0 && (
        <section
          aria-label="Available practice exams"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
        >
          {visibleExams.map((exam, index) => (
            <BrowseExamCard
              key={exam.id}
              exam={exam}
              variant={getCardVariant(index)}
              iconIndex={index}
              isStarting={startingExamId === exam.id}
              onStartExam={handleStartExam}
            />
          ))}
        </section>
      )}
    </section>
  );
}