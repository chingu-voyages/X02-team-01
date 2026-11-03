"use client";

import { useState, type FormEvent } from "react";
import ResultCard from "@/features/exams/ResultCard";
import { getExamResults } from "@/lib/exam-results";
import type { ExamResultsResponse } from "@/types/exam-api.types";

export default function DevResultsPage() {
  const [attemptId, setAttemptId] = useState("");
  const [token, setToken] = useState("");
  const [results, setResults] =
    useState<ExamResultsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");
    setResults(null);

    try {
      const data = await getExamResults(
        attemptId.trim(),
        token.trim(),
      );

      if (data.attempt_id !== attemptId.trim()) {
        throw new Error("Unexpected exam attempt returned.");
      }

      if (!data.grading_complete) {
        throw new Error("Exam grading is not complete.");
      }

      setResults(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load exam results.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Development-only testing page.
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        Exam Results — Integration Test
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="attempt-id">Attempt ID</label>
          <input
            id="attempt-id"
            value={attemptId}
            onChange={(e) => setAttemptId(e.target.value)}
            placeholder="Paste exam attempt ID"
            className="w-full rounded border p-2"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="access-token">Bearer token</label>
          <input
            id="access-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste development token"
            className="w-full rounded border p-2"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Loading..." : "Get Results"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {results && (
        <ResultCard
          scorePercent={results.score_percent}
          correctCount={results.correct_count}
          incorrectCount={results.incorrect_count}
          isPassed={results.passed}
          passingScorePercent={results.passing_score_percent}
        />
      )}
    </main>
  );
}
