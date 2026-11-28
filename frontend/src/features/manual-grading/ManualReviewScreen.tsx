"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getWrittenResponseDetail,
  submitManualGrade,
} from "@/lib/manual-grading-api";

import type {
  WrittenResponseDetail,
} from "@/types/exam-api.types";

interface ManualReviewScreenProps {
  attemptId: string;
  questionVersionId: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: WrittenResponseDetail }
  | { status: "error"; message: string };

export default function ManualReviewScreen({
  attemptId,
  questionVersionId,
}: ManualReviewScreenProps) {
  const { token, role, ready, handleError } = useDemoSession();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canReview = role === "administrator" || role === "contributor";

  const load = useCallback(
    async (activeToken: string) => {
      setState({ status: "loading" });
      try {
        const data = await getWrittenResponseDetail(
          activeToken,
          attemptId,
          questionVersionId,
        );
        setState({ status: "ready", data });
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load this response.",
        });
      }
    },
    [attemptId, questionVersionId, handleError],
  );

  useEffect(() => {
    if (!ready || !token || !canReview) return;
    void Promise.resolve().then(() => load(token));
  }, [ready, token, canReview, load]);

  if (!ready) {
    return <p role="status">Checking session...</p>;
  }

  if (!canReview) {
    return (
      <p role="alert">
        Only administrators and contributors can review written responses.
      </p>
    );
  }

  if (state.status === "loading") {
    return <p role="status">Loading response...</p>;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 rounded-md border border-brand-border bg-white p-5">
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => {
            if (token) void load(token);
          }}
          className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text"
        >
          Retry
        </button>
      </div>
    );
  }

  const detail = state.data;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const parsed = Number(score);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > detail.max_points) {
      setSubmitError(`Enter a whole number from 0 to ${detail.max_points}.`);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const result = await submitManualGrade(
        token,
        attemptId,
        questionVersionId,
        parsed,
        feedback.trim() ? feedback.trim() : null,
      );
      setSuccess(
        result.action === "revised"
          ? `Grade revised to ${result.score}/${result.max_points}.`
          : `Final grade recorded: ${result.score}/${result.max_points}.`,
      );
      await load(token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setSubmitError(
        error instanceof Error ? error.message : "Unable to record the grade.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <Link
          href="/admin/manual-grading"
          className="text-sm font-medium text-brand-text/70 hover:text-brand-text"
        >
          Back to grading queue
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl">
          Review written response
        </h1>
        <p className="text-sm text-brand-text/70">
          {detail.response_type === "essay" ? "Essay" : "Short answer"} · Maximum
          score {detail.max_points}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-md border border-brand-border bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-text/60">
              Question
            </h2>
            <p className="mt-2 text-sm leading-6 text-brand-text">
              {detail.question_text}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-text/60">
              Learner response
            </h2>
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-brand-surface/60 p-4 text-sm leading-6 text-brand-text">
              {detail.learner_response}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-text/60">
              Expected answer / rubric reference
            </h2>
            <p className="mt-2 text-sm leading-6 text-brand-text/80">
              {detail.expected_answer ?? "No expected answer is configured."}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-brand-border bg-white p-5">
            <h2 className="text-sm font-semibold text-brand-text">
              {detail.provisional_ai_feedback.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-brand-text/70">
              {detail.provisional_ai_feedback.available
                ? detail.provisional_ai_feedback.content
                : "No provisional AI feedback is available. It is never treated as a final grade."}
            </p>
          </div>

          <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            className="space-y-4 rounded-md border border-brand-border bg-white p-5"
          >
            <h2 className="text-base font-semibold text-brand-text">
              {detail.current_grade ? "Revise final grade" : "Record final grade"}
            </h2>

            {detail.current_grade && (
              <p className="text-sm text-brand-text/70">
                Current: {detail.current_grade.points_earned}/
                {detail.current_grade.max_points} by{" "}
                {detail.current_grade.grader_role ?? "unknown reviewer"}
              </p>
            )}

            <div>
              <label
                htmlFor="manual-score"
                className="block text-sm font-medium text-brand-text"
              >
                Score (0–{detail.max_points})
              </label>
              <input
                id="manual-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={detail.max_points}
                step={1}
                value={score}
                onChange={(event) => setScore(event.target.value)}
                className="mt-1 w-full rounded-md border border-brand-border px-3 py-2 text-sm text-brand-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
            </div>

            <div>
              <label
                htmlFor="manual-feedback"
                className="block text-sm font-medium text-brand-text"
              >
                Feedback (optional)
              </label>
              <textarea
                id="manual-feedback"
                rows={4}
                maxLength={5000}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                className="mt-1 w-full rounded-md border border-brand-border px-3 py-2 text-sm text-brand-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Submit final grade"}
            </button>

            <p aria-live="polite" className="text-sm text-emerald-800">
              {success}
            </p>
            <p role="alert" className="text-sm text-red-700">
              {submitError}
            </p>
          </form>
        </div>
      </div>

      <section className="rounded-md border border-brand-border bg-white p-5">
        <h2 className="text-base font-semibold text-brand-text">
          Grading history
        </h2>
        {detail.history.length === 0 ? (
          <p className="mt-2 text-sm text-brand-text/70">
            No grades have been recorded yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-border text-xs uppercase tracking-wide text-brand-text/60">
                <th scope="col" className="py-2">Action</th>
                <th scope="col" className="py-2">Reviewer</th>
                <th scope="col" className="py-2">Score</th>
                <th scope="col" className="py-2">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {detail.history.map((entry, index) => (
                <tr
                  key={`${entry.created_at}:${index}`}
                  className="border-b border-brand-border/70 last:border-0"
                >
                  <td className="py-2 capitalize">{entry.action}</td>
                  <td className="py-2">{entry.grader_role}</td>
                  <td className="py-2">
                    {entry.score}/{entry.max_points}
                  </td>
                  <td className="py-2">{entry.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
