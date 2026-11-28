"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getCompletedExamReview } from "@/lib/exam-review";
import { getCompletedQuestionReview, questionReviewHref, reviewNeighbors } from "@/lib/exam-question-review";
import type { CompletedQuestionReview } from "@/types/exam-question-review.types";
import CompletedQuestionContent from "./CompletedQuestionContent";
import QuestionReviewStatus from "./QuestionReviewStatus";

interface Props { attemptId: string; questionVersionId: string; accessToken: string }
type Result = { status: "loading" } |
  { status: "success"; detail: CompletedQuestionReview; neighbors: ReturnType<typeof reviewNeighbors> } |
  { status: "error"; message: string; retryable: boolean };
type State = Props & { retry: number; result: Result };

function errorResult(error: unknown): Result {
  if (error instanceof ApiError) {
    if (error.status === 401) return { status: "error", message: "Your session has expired. Please sign in again.", retryable: false };
    if (error.status === 403 || error.status === 404 || error.status === 422) return { status: "error", message: "This question review is unavailable.", retryable: false };
    if (error.status === 409) return { status: "error", message: "This question cannot be reviewed. Make sure the exam is completed.", retryable: false };
  }
  return { status: "error", message: "Unable to load question review. Please try again.", retryable: true };
}

const linkStyle = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-brand-border bg-white px-3 py-2 text-sm font-semibold text-brand-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary";

export default function CompletedQuestionReviewScreen({ attemptId, questionVersionId, accessToken }: Props) {
  const { logout } = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const result: Result = state?.attemptId === attemptId && state.questionVersionId === questionVersionId &&
    state.accessToken === accessToken && state.retry === retry ? state.result : { status: "loading" };
  const reviewHref = `/exams/${encodeURIComponent(attemptId)}/review`;

  useEffect(() => {
    const controller = new AbortController();
    const scope = { attemptId, questionVersionId, accessToken, retry };
    const load = async () => {
      try {
        const detail = await getCompletedQuestionReview(attemptId, questionVersionId, accessToken, controller.signal);
        if (controller.signal.aborted) return;
        const list = await getCompletedExamReview(attemptId, accessToken, controller.signal);
        if (controller.signal.aborted) return;
        const neighbors = reviewNeighbors(detail, list.questions);
        setState({ ...scope, result: { status: "success", detail, neighbors } });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({ ...scope, result: errorResult(error) });
        if (error instanceof ApiError && error.status === 401) logout();
      }
    };
    void load();
    return () => controller.abort();
  }, [attemptId, questionVersionId, accessToken, retry, logout]);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <Link href={reviewHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />Back to questions
      </Link>
      <header className="space-y-2">
        <p className="text-sm font-medium text-brand-text/80">Completed exam · Read-only review</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{result.status === "success" ? `Question ${result.detail.position} of ${result.detail.question_count}` : "Question review"}</h1>
        {result.status === "success" && <QuestionReviewStatus status={result.detail.question_status} />}
      </header>
      {result.status === "loading" ? (
        <p role="status" className="rounded-xl border border-brand-border bg-white p-4">Loading question review...</p>
      ) : result.status === "error" ? (
        <section className="space-y-4 rounded-xl border border-brand-border bg-white p-4 sm:p-6">
          <p role="alert" className="text-sm text-red-800">{result.message}</p>
          {result.retryable && <Button type="button" variant="outline" className="min-h-11" onClick={() => setRetry((count) => count + 1)}>Retry loading question</Button>}
        </section>
      ) : (
        <>
          <CompletedQuestionContent key={result.detail.question_version_id} detail={result.detail} />
          <nav aria-label="Review question navigation" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {result.neighbors.previous ? <Link prefetch={false} href={questionReviewHref(attemptId, result.neighbors.previous.question_version_id)} className={linkStyle}><ChevronLeft aria-hidden="true" className="size-4 shrink-0" />Previous question</Link> : <span className="flex min-h-11 items-center justify-center rounded-xl border border-brand-border bg-brand-surface p-2 text-sm text-brand-text/80">First question</span>}
            {result.neighbors.next ? <Link prefetch={false} href={questionReviewHref(attemptId, result.neighbors.next.question_version_id)} className={linkStyle}>Next question<ChevronRight aria-hidden="true" className="size-4 shrink-0" /></Link> : <Link href={reviewHref} className={linkStyle}>Back to question list</Link>}
          </nav>
        </>
      )}
    </div>
  );
}
