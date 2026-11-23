"use client";

import { useState } from "react";
import Link from "next/link";

import Card from "@/components/ui/Card";
import FormInput from "@/components/ui/FormInput";

const passwordRules = [
  { test: (v: string) => v.length >= 8, message: "At least 8 characters" },
  {
    test: (v: string) => /[A-Z]/.test(v),
    message: "An uppercase letter",
  },
  {
    test: (v: string) => /[a-z]/.test(v),
    message: "A lowercase letter",
  },
  { test: (v: string) => /\d/.test(v), message: "A digit" },
];

function validateNewPassword(value: string): string | null {
  for (const rule of passwordRules) {
    if (!rule.test(value)) {
      return `Password must contain ${rule.message.toLowerCase()}`;
    }
  }
  return null;
}

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // JHEP-124 AC2: expired/used/unknown links never reach a working form.
  if (!token) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h2 className="text-xl font-bold">Reset link missing</h2>
          <p
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            This page needs the one-time link from your password-reset
            email. Request a fresh one from the{" "}
            <Link href="/forgot-password" className="underline font-medium">
              forgot-password page
            </Link>
            .
          </p>
        </div>
      </Card>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const policyError = validateNewPassword(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 400) {
        setError(
          data.message ??
            "This reset link is invalid, expired, or already used. Request a fresh one.",
        );
        return;
      }
      if (response.status === 422) {
        setError(data.message ?? "That password doesn't meet the policy.");
        return;
      }
      if (!response.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }

      setResetDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (resetDone) {
    return (
      <Card className="p-6">
        <div className="space-y-3">
          <h2 className="text-xl font-bold">Password updated</h2>
          <p role="status" className="text-sm text-gray-600">
            Your password has been changed and any open sessions were
            signed out. Sign in with your new password.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a]"
          >
            Sign in
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Choose a new password</h2>

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
            <FormInput
              label="New password"
              id="new-password"
              name="new-password"
              type="password"
              passwordToggle
              value={password}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setPassword(event.target.value)
              }
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-gray-500">
              At least 8 characters, with an uppercase letter, a lowercase
              letter, and a digit.
            </p>
          </div>

          <div className="space-y-1">
            <FormInput
              label="Confirm new password"
              id="confirm-password"
              name="confirm-password"
              type="password"
              passwordToggle
              value={confirm}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setConfirm(event.target.value)
              }
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </Card>
  );
}
