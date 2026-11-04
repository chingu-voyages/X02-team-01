"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/AuthProvider";

function AccessForm() {
  const [tokenInput, setTokenInput] = useState("");
  const { setToken } = useAuth();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/categories";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (trimmed) {
      setToken(trimmed, redirectTo);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border p-6 shadow-sm">
        <h1 className="text-xl font-bold mb-4">Demo Access Token</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter the short-lived bearer token supplied by the backend owner for local development.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="token">
              Bearer access token
            </label>
            <input
              id="token"
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste your JWT here..."
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded bg-blue-600 text-white py-2 px-4 text-sm font-medium hover:bg-blue-700 transition"
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
    <Suspense fallback={<div className="p-6">Loading access screen...</div>}>
      <AccessForm />
    </Suspense>
  );
}