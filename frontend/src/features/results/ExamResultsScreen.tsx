"use client";

import { useEffect, useState } from "react";

import QuestionResultsList from "./QuestionResultsList";
import ResultCard from "./ResultCard";
import { Button } from "@/components/ui/button";
import { getExamResults } from "@/lib/exam-results";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/AuthProvider";

import type { ExamResultsResponse } from "@/types/exam-api.types";

interface ExamResultsScreenProps {
  attemptId: string;
  accessToken: string;
  reviewHref?: string;
}

type ResultsState =
  | { status: "loading" }
  | { status: "success"; data: ExamResultsResponse }
  | { status: "error"; message: string };

type ScopedResultsState = {
  attemptId: string;
  accessToken: string;
  result: ResultsState;
};

export default function ExamResultsScreen({
  attemptId,
  accessToken,
  reviewHref,
}: ExamResultsScreenProps) {
  const { logout } = useAuth();

  const [storedState, setStoredState] = useState<ScopedResultsState | null>(null);
  const state: ResultsState =
    storedState?.attemptId === attemptId && storedState.accessToken === accessToken
      ? storedState.result
      : { status: "loading" };

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getExamResults(attemptId, accessToken)
      .then((data) => {
        if (cancelled) return;

        if (data.attempt_id !== attemptId || data.status !== "submitted") {
          throw new Error("Unexpected exam result received.");
        }

        setStoredState({
          attemptId,
          accessToken,
          result: { status: "success", data },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        // Clear the session when the backend rejects the JWT.
        if (error instanceof ApiError && error.status === 401) {
          logout();
          return;
        }

        // Preserve error handling for all other failures.
        setStoredState({
          attemptId,
          accessToken,
          result: {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load exam results.",
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attemptId, accessToken, retryCount, logout]);

  if (state.status === "loading") {
    return (
      <p role="status" className="p-6 text-brand-text">
        Loading exam results...
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <section className="rounded-2xl bg-brand-surface border border-brand-border p-6 text-brand-text shadow-xs">
        <p role="alert" className="mb-4 text-sm text-red-700">
          {state.message}
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setStoredState(null);
            setRetryCount((count) => count + 1);
          }}
          className="border-brand-border text-brand-text hover:bg-brand-surface"
        >
          Retry loading results
        </Button>
      </section>
    );
  }

  const results = state.data;
  const questions = results.questions ?? [];

  return (
    <div className="space-y-6">
      <ResultCard
        reviewHref={reviewHref}
        scorePercent={results.score_percent}
        correctCount={results.correct_count}
        incorrectCount={results.incorrect_count}
        isPassed={results.passed}
        passingScorePercent={results.passing_score_percent}
        isGradingComplete={results.grading_complete}
        pendingManualGradingCount={results.pending_manual_grading_count ?? 0}
        questionCount={questions.length > 0 ? questions.length : undefined}
        hasManualGrading={questions.some(
          (question) => question.outcome === "manually_graded",
        )}
      />
      <QuestionResultsList questions={questions} />
    </div>
  );
}
