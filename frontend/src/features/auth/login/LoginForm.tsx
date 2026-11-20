"use client";

import FormInput from "@/components/ui/FormInput";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "../AuthProvider";

type UserRole =
  | "learner"
  | "contributor"
  | "administrator";

type LoginResponse = {
  mfa_required?: boolean;
  challenge_id?: string;
  access_token: string;
  token_type: "bearer";
  learner: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    is_verified: boolean;
    status: "pending_verification" | "verified";
    created_at: string;
  };
};

export default function LoginForm() {
  const { setToken } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState<
    Record<string, string>
  >({});

  const [touched, setTouched] = useState<
    Record<string, boolean>
  >({});

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [authError, setAuthError] = useState<
    string | null
  >(null);

  // JHEP-109: the second-factor phase — when the password stage
  // returns mfa_required, the form flips into the TOTP challenge and
  // holds the 5-minute challenge token until verification succeeds.
  const [mfaChallenge, setMfaChallenge] = useState<{
    token: string;
    challengeId: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((previous) => ({
        ...previous,
        [name]: "",
      }));
    }

    if (authError) {
      setAuthError(null);
    }
  };

  const handleBlur = (field: string) => {
    setTouched((previous) => ({
      ...previous,
      [field]: true,
    }));
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setTouched({
      email: true,
      password: true,
    });

    const newErrors: Record<string, string> = {};

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    }

    if (!formData.password.trim()) {
      newErrors.password = "Password is required.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      const response = await fetch(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: formData.email.trim(),
            password: formData.password,
          }),
        },
      );

      const data: unknown = await response.json();

      if (!response.ok) {
        let message =
          "Invalid email or password.";

        if (
          data !== null &&
          typeof data === "object"
        ) {
          if (
            "message" in data &&
            typeof data.message === "string"
          ) {
            message = data.message;
          } else if (
            "detail" in data &&
            data.detail !== null &&
            typeof data.detail === "object" &&
            "message" in data.detail &&
            typeof data.detail.message === "string"
          ) {
            message = data.detail.message;
          }
        }

        throw new Error(message);
      }

      const loginData = data as LoginResponse;

      // JHEP-109: the password stage passed but the second factor is
      // required — flip into the challenge phase; NO session yet.
      if (loginData.mfa_required && loginData.challenge_id) {
        setMfaChallenge({
          token: loginData.access_token,
          challengeId: loginData.challenge_id,
        });
        return;
      }

      const isStaff =
        loginData.learner.role ===
          "administrator" ||
        loginData.learner.role === "contributor";

      // JHEP-109 (PO decision): an Administrator who hasn't enrolled is
      // routed to the Security page BEFORE the app — the mandatory
      // enrollment prompt. The session token still works for the
      // security page itself.
      if (loginData.learner.role === "administrator") {
        try {
          const statusResponse = await fetch(
            "/api/v1/auth/mfa/status",
            {
              headers: {
                Authorization: `Bearer ${loginData.access_token}`,
              },
            },
          );
          const mfaStatus = (await statusResponse.json()) as {
            mandatory?: boolean;
            enrolled?: boolean;
          };
          if (mfaStatus.mandatory && mfaStatus.enrolled === false) {
            setToken(
              loginData.access_token,
              "/account/security",
            );
            return;
          }
        } catch {
          // the status probe failing must not block sign-in — the
          // Security page re-checks anyway
        }
      }

      const destination = isStaff
        ? "/admin/questions"
        : "/categories";

      setToken(
        loginData.access_token,
        destination,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // JHEP-109: the second-factor challenge screen — the password stage
  // passed; the account requires TOTP (or a recovery code).
  const handleMfaVerify = async () => {
    if (!mfaChallenge || mfaSubmitting) return;
    setMfaSubmitting(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/v1/auth/mfa/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mfaChallenge.token}`,
        },
        body: JSON.stringify({
          code: mfaCode.trim(),
          recovery_code: useRecovery,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        let message = "That code didn't work.";
        if (data !== null && typeof data === "object") {
          const record = data as { message?: unknown; detail?: unknown };
          if (
            typeof record.message === "string"
          ) {
            message = record.message;
          } else if (
            record.detail !== null &&
            typeof record.detail === "object" &&
            "message" in (record.detail as Record<string, unknown>) &&
            typeof (record.detail as Record<string, unknown>).message ===
              "string"
          ) {
            message = (record.detail as Record<string, unknown>)
              .message as string;
          }
        }
        setAuthError(message);
        return;
      }
      const loginData = data as LoginResponse;
      const isStaff =
        loginData.learner.role === "administrator" ||
        loginData.learner.role === "contributor";
      setToken(
        loginData.access_token,
        isStaff ? "/admin/questions" : "/categories",
      );
    } catch {
      setAuthError("Network error. Please try again.");
    } finally {
      setMfaSubmitting(false);
    }
  };

  if (mfaChallenge) {
    return (
      <div>
        <h2 className="font-bold text-2xl">
          Two-factor verification
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Enter the 6-digit code from your authenticator app
          {useRecovery ? " or paste a recovery code" : ""}.
        </p>

        {authError && (
          <div
            className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-sm"
            role="alert"
          >
            {authError}
          </div>
        )}

        <form
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            void handleMfaVerify();
          }}
          className="mt-4 space-y-4"
        >
          <div className="space-y-1">
            <label
              htmlFor="mfa-code"
              className="text-sm font-semibold"
            >
              {useRecovery ? "Recovery code" : "Authenticator code"}
            </label>
            <input
              id="mfa-code"
              name="mfa-code"
              type="text"
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setMfaCode(event.target.value)
              }
              required
              className="w-full bg-white rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900"
            />
          </div>

          <button
            type="submit"
            disabled={mfaSubmitting}
            className="w-full rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mfaSubmitting ? "Verifying..." : "Verify"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setUseRecovery((previous) => !previous);
            setMfaCode("");
            setAuthError(null);
          }}
          className="mt-3 text-sm text-gray-600 hover:underline hover:cursor-pointer"
        >
          {useRecovery
            ? "Use an authenticator code instead"
            : "Lost your device? Use a recovery code"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-bold text-2xl">
        Sign in to your account
      </h2>

      {authError && (
        <div
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-sm"
          role="alert"
        >
          {authError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        noValidate
      >
        <FormInput
          label="Email address"
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          value={formData.email}
          onChange={handleChange}
          onBlur={() => handleBlur("email")}
          error={
            touched.email
              ? errors.email
              : undefined
          }
        />

        <FormInput
          label="Password"
          id="password"
          name="password"
          type="password"
          passwordToggle
          placeholder="Enter your password"
          value={formData.password}
          onChange={handleChange}
          onBlur={() => handleBlur("password")}
          error={
            touched.password
              ? errors.password
              : undefined
          }
        />

        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="self-start py-6 px-4 text-base hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? "Signing in..."
              : "Sign in"}
          </Button>

          <p className="text-sm text-gray-600">
            <Link
              href="/forgot-password"
              className="text-primary hover:underline font-medium"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="text-sm text-gray-600">
            New to the platform?{" "}
            <Link
              href="/register"
              className="text-primary hover:underline font-medium"
            >
              Create an account
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}