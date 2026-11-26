"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import ManualReviewScreen from "@/features/manual-grading/ManualReviewScreen";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ReviewPageContent() {
  const { attemptId, questionVersionId } = useParams<{
    attemptId: string;
    questionVersionId: string;
  }>();

  if (
    !attemptId ||
    !questionVersionId ||
    !uuidPattern.test(attemptId) ||
    !uuidPattern.test(questionVersionId)
  ) {
    return (
      <main className="min-h-screen bg-brand-surface p-6">
        <p role="alert">Invalid response reference.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-surface px-4 py-6 sm:px-6 lg:px-8">
      <ManualReviewScreen
        attemptId={attemptId}
        questionVersionId={questionVersionId}
      />
    </main>
  );
}

export default function ManualReviewPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-brand-surface p-6">
          <p role="status">Loading review...</p>
        </main>
      }
    >
      <ReviewPageContent />
    </Suspense>
  );
}
