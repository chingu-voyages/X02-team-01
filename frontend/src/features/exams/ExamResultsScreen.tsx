"use client";

import { useEffect, useState } from "react";
import ResultCard from "./ResultCard";
import { getExamResults } from "@/lib/exam-results";
import type { ExamResultsResponse } from "@/types/exam-api.types";

interface ExamResultsScreenProps {
  attemptId: string;
  accessToken: string;
}

type ResultsState =
  | { status: "loading" }
  | { status: "success"; data: ExamResultsResponse }
  | { status: "error"; message: string };

export default function ExamResultsScreen({
  attemptId,
  accessToken,
}: ExamResultsScreenProps) {
  const [state, setState] = useState<ResultsState>({
    status: "loading",
  });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getExamResults(attemptId, accessToken)
      .then((data) => {
        if (cancelled) return;

        if (
          data.attempt_id !== attemptId ||
          data.status !== "submitted"
        ) {
          throw new Error("Unexpected exam result received.");
        }

        if (!data.grading_complete) {
          throw new Error("Exam grading is not complete.");
        }

        setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load exam results.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attemptId, accessToken, retryCount]);

  if (state.status === "loading") {
    return <p role="status">Loading exam results...</p>;
  }

  if (state.status === "error") {
    return (
      <div>
        <p role="alert">{state.message}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setRetryCount((count) => count + 1);
          }}
        >
          Retry loading results
        </button>
      </div>
    );
  }

  const results = state.data;

  return (
    <ResultCard
      scorePercent={results.score_percent}
      correctCount={results.correct_count}
      incorrectCount={results.incorrect_count}
      isPassed={results.passed}
      passingScorePercent={results.passing_score_percent}
    />
  );
}
