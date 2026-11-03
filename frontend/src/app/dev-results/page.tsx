
"use client";

import { useState, type FormEvent } from "react";
import ExamResultsScreen from "@/features/exams/ExamResultsScreen";

interface TestRequest {
  attemptId: string;
  accessToken: string;
  requestNumber: number;
}

export default function DevResultsPage() {
  const [attemptId, setAttemptId] = useState("");
  const [token, setToken] = useState("");
  const [request, setRequest] = useState<TestRequest | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setRequest((previous) => ({
      attemptId: attemptId.trim(),
      accessToken: token.trim(),
      requestNumber: (previous?.requestNumber ?? 0) + 1,
    }));
  }

  // Temporary development-only integration page.
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">
        Exam Results — Integration Test
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="attempt-id">Attempt ID</label>
          <input
            id="attempt-id"
            type="text"
            value={attemptId}
            onChange={(event) => setAttemptId(event.target.value)}
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
            onChange={(event) => setToken(event.target.value)}
            className="w-full rounded border p-2"
            required
          />
        </div>

        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Get Results
        </button>
      </form>

      {request && (
        <ExamResultsScreen
          key={request.requestNumber}
          attemptId={request.attemptId}
          accessToken={request.accessToken}
        />
      )}
    </main>
  );
}
