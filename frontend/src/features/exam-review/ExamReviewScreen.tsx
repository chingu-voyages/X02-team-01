"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getCompletedExamReview } from "@/lib/exam-review";
import { questionReviewHref } from "@/lib/exam-question-review";
import QuestionReviewStatus, { statusInfo } from "./QuestionReviewStatus";
import {
  reviewStatuses,
  type CompletedExamReview,
  type ReviewQuestion,
  type ReviewStatus,
} from "@/types/exam-review.types";

function ReviewQuestions({ questions, attemptId }: { questions: ReviewQuestion[]; attemptId: string }) {
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const visible = filter === "all" ? questions : questions.filter((question) => question.status === filter);

  return (
    <section aria-labelledby="review-questions-heading" className="min-w-0 space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {reviewStatuses.map((status) => (
          <div key={status} className="min-w-0 rounded-xl border border-brand-border bg-white p-3">
            <dt className="wrap-break-word text-sm text-brand-text/80">{statusInfo[status].label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{questions.filter((question) => question.status === status).length}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="review-questions-heading" className="text-lg font-bold">Questions</h2>
          <p role="status" className="mt-1 text-sm text-brand-text/80">
            Showing {visible.length} of {questions.length} questions
          </p>
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor="review-status-filter" className="block text-sm font-semibold">Filter by status</label>
          <select
            id="review-status-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as ReviewStatus | "all")}
            className="min-h-11 w-full max-w-full rounded-xl border border-brand-border bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:w-52"
          >
            <option value="all">All questions</option>
            {reviewStatuses.map((status) => (
              <option key={status} value={status}>{statusInfo[status].label}</option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-brand-border bg-white p-4 sm:p-6">
          <p>No questions match this status.</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setFilter("all")}>
            Show all questions
          </Button>
        </div>
      ) : (
        <ol className="min-w-0 space-y-2" aria-label="Completed exam questions">
          {visible.map((question) => (
            <li key={question.question_version_id} value={question.position} className="min-w-0">
              <Link href={questionReviewHref(attemptId, question.question_version_id)} prefetch={false} aria-label={`Review question ${question.position}: ${statusInfo[question.status].label}`} className="block min-h-11 min-w-0 rounded-xl border border-brand-border bg-white p-4 shadow-xs transition-colors hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Question {question.position}</h3>
                  <QuestionReviewStatus status={question.status} />
                </div>
                <p className="mt-2 wrap-anywhere text-sm leading-6 text-brand-text/85">{question.preview}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-primary">Review question <ChevronRight aria-hidden="true" className="size-4 shrink-0" /></span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm leading-6 text-brand-text/80">Open any question to see your recorded answer and available feedback.</p>
    </section>
  );
}

type ReviewState =
  | { status: "loading" }
  | { status: "success"; data: CompletedExamReview }
  | { status: "error"; message: string; retryable: boolean };

interface ExamReviewScreenProps {
  attemptId: string;
  accessToken: string;
}

type ScopedState = ExamReviewScreenProps & { retry: number; result: ReviewState };

function reviewError(error: unknown): ReviewState {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { status: "error", message: "Your session has expired. Please sign in again.", retryable: false };
    }
    if (error.status === 403 || error.status === 404) {
      return { status: "error", message: "This exam review is unavailable.", retryable: false };
    }
    if (error.status === 409) {
      return { status: "error", message: "Finish the practice exam before reviewing its answers.", retryable: false };
    }
  }
  return { status: "error", message: "Unable to load exam review. Please try again.", retryable: true };
}

export default function ExamReviewScreen({ attemptId, accessToken }: ExamReviewScreenProps) {
  const { logout } = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ScopedState | null>(null);
  // Suppress stale data immediately on an attempt/session change, even before
  // the old effect is cleaned up or a new request completes.
  const result: ReviewState = state?.attemptId === attemptId && state.accessToken === accessToken && state.retry === retry
    ? state.result
    : { status: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    const scope = { attemptId, accessToken, retry };
    getCompletedExamReview(attemptId, accessToken, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ ...scope, result: { status: "success", data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ ...scope, result: reviewError(error) });
        if (error instanceof ApiError && error.status === 401) logout();
      });
    return () => controller.abort();
  }, [attemptId, accessToken, retry, logout]);

  const resultsHref = `/exams/${encodeURIComponent(attemptId)}/results`;

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <Link href={resultsHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        Back to Results
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Review answers</h1>
        <p className="text-sm leading-6 text-brand-text/80">Browse the original questions from your completed exam and identify what to practice next.</p>
      </header>
      {result.status === "loading" ? (
        <p role="status" className="rounded-xl border border-brand-border bg-white p-4">Loading exam review...</p>
      ) : result.status === "error" ? (
        <section className="space-y-4 rounded-xl border border-brand-border bg-white p-4 sm:p-6">
          <p role="alert" className="text-sm text-red-800">{result.message}</p>
          {result.retryable && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setRetry((count) => count + 1)}>
              Retry loading review
            </Button>
          )}
          <Link href="/categories" className="block w-fit rounded-lg py-3 text-sm font-semibold text-brand-primary underline focus-visible:outline-2 focus-visible:outline-offset-2">
            Back to practice exams
          </Link>
        </section>
      ) : result.data.questions.length === 0 ? (
        <section className="space-y-2 rounded-xl border border-brand-border bg-white p-4 sm:p-6">
          <h2 className="font-semibold">No questions available</h2>
          <p className="text-sm leading-6 text-brand-text/80">There are no questions available to review for this attempt.</p>
        </section>
      ) : (
        <ReviewQuestions questions={result.data.questions} attemptId={attemptId} />
      )}
    </div>
  );
}
