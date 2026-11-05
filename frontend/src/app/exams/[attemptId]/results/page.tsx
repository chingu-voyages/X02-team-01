"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { useDemoSession } from "@/features/auth/AuthProvider";
import ExamResultsScreen from "@/features/exams/ExamResultsScreen";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ResultsPageContent() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { token, ready } = useDemoSession();

  if (!ready || !token) {
    return (
      <main className="min-h-screen bg-[#f3f4f5] p-6">
        <p role="status">Checking session...</p>
      </main>
    );
  }

  if (!attemptId || !uuidPattern.test(attemptId)) {
    return (
      <main className="min-h-screen bg-[#f3f4f5] p-6">
        <p role="alert">Invalid exam attempt ID.</p>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#f3f4f5] px-4 py-6 text-[#2c3134] sm:px-6 lg:px-8"
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <ExamResultsScreen
          attemptId={attemptId}
          accessToken={token}
        />
      </div>
    </main>
  );
}

export default function ExamResultsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#f3f4f5] p-6">
          <p role="status">Loading exam results...</p>
        </main>
      }
    >
      <ResultsPageContent />
    </Suspense>
  );
}
