"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import ExamReviewScreen from "@/features/exam-review/ExamReviewScreen";
import { reviewUuidPattern } from "@/lib/exam-review";

function ReviewPageContent() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { token, ready } = useDemoSession();

  if (!ready || !token) {
    return <p role="status">Checking session...</p>;
  }

  if (!attemptId || !reviewUuidPattern.test(attemptId)) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">Exam review unavailable</h1>
        <p role="alert">Invalid exam attempt ID.</p>
        <Link
          href="/categories"
          className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-brand-primary underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to practice exams
        </Link>
      </section>
    );
  }

  return <ExamReviewScreen attemptId={attemptId} accessToken={token} />;
}

export default function ExamReviewPage() {
  return (
    <main className="min-h-screen min-w-0 bg-brand-surface px-4 py-6 text-brand-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl min-w-0">
        <Suspense fallback={<p role="status">Loading exam review...</p>}>
          <ReviewPageContent />
        </Suspense>
      </div>
    </main>
  );
}
