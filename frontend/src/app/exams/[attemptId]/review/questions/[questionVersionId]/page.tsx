"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import CompletedQuestionReviewScreen from "@/features/exam-review/CompletedQuestionReviewScreen";
import { reviewUuidPattern } from "@/lib/exam-review";

function QuestionReviewPageContent() {
  const { attemptId, questionVersionId } = useParams<{ attemptId: string; questionVersionId: string }>();
  const { token, ready } = useDemoSession();
  if (!ready || !token) return <p role="status">Checking session...</p>;
  const validAttempt = typeof attemptId === "string" && reviewUuidPattern.test(attemptId);
  if (!validAttempt || typeof questionVersionId !== "string" || !reviewUuidPattern.test(questionVersionId)) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">Question review unavailable</h1>
        <p role="alert">Invalid question review link.</p>
        <Link href={validAttempt ? `/exams/${encodeURIComponent(attemptId)}/review` : "/categories"} className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-primary underline focus-visible:outline-2 focus-visible:outline-offset-2">{validAttempt ? "Back to questions" : "Back to practice exams"}</Link>
      </section>
    );
  }
  return <CompletedQuestionReviewScreen attemptId={attemptId} questionVersionId={questionVersionId} accessToken={token} />;
}

export default function QuestionReviewPage() {
  return (
    <main className="min-h-screen min-w-0 bg-brand-surface px-4 py-6 text-brand-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl min-w-0">
        <Suspense fallback={<p role="status">Loading question review...</p>}><QuestionReviewPageContent /></Suspense>
      </div>
    </main>
  );
}
