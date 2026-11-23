"use client";

import { useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";

// JHEP-124 AC1: the confirmation is generic — identical whether or not
// an account exists, so the form never reveals account existence.
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Enter the email you registered with");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok && response.status !== 429) {
        setError("Something went wrong. Please try again.");
        return;
      }

      if (response.status === 429) {
        const data = await response.json();
        setError(data.message ?? "Too many requests. Please wait a minute.");
        return;
      }

      setRequestSent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (requestSent) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h2 className="text-xl font-bold">Check your email</h2>
          <p role="status" className="text-sm text-gray-600">
            If an account exists for that email, a password-reset link is
            on its way. It works once and expires in an hour.
          </p>
          <p className="text-sm text-gray-600">
            Didn&apos;t receive anything?{" "}
            <button
              type="button"
              onClick={() => setRequestSent(false)}
              className="text-primary hover:underline font-medium"
            >
              Try again
            </button>{" "}
            or{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              back to sign in
            </Link>
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Forgot your password?</h2>
        <p className="text-sm text-gray-600">
          Enter the email you registered with and we&apos;ll send you a
          one-time reset link.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="reset-email"
              className="text-sm font-semibold"
            >
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(event.target.value)
              }
              autoComplete="email"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="text-sm text-gray-600">
          Remembered it?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </Card>
  );
}
