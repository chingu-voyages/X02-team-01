"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/AuthProvider";

// Only allow known internal destinations.
function safeRedirect(value: string | null): string {
  if (value === "/categories") {
    return value;
  }

  const examRoute =
    /^\/exams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/results)?$/i;

  if (value && examRoute.test(value)) {
    return value;
  }

  return "/categories";
}

function AccessForm() {
  const [tokenInput, setTokenInput] = useState("");
  const { setToken } = useAuth();
  const searchParams = useSearchParams();

  const redirectTo = safeRedirect(
    searchParams.get("redirect"),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = tokenInput.trim();

    if (!token) {
      return;
    }

    setToken(token, redirectTo);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-bold">
          Demo Access Token
        </h1>

        <p className="mb-6 text-sm text-gray-600">
          Enter the short-lived bearer token supplied
          by the backend owner for local development.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="token"
              className="mb-1 block text-sm font-medium"
            >
              Bearer access token
            </label>

            <input
              id="token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={(event) =>
                setTokenInput(event.target.value)
              }
              placeholder="Paste your JWT here..."
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Authenticate & Continue
          </button>
        </form>
      </div>
    </main>
  );
}

export default function AccessPage() {
  return (
    <Suspense fallback={<div>Loading access screen...</div>}>
      <AccessForm />
    </Suspense>
  );
}
