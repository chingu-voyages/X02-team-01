"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";

import FormInput from "@/components/ui/FormInput";
import { Button } from "@/components/ui/button";
import { useAuth } from "../AuthProvider";

type UserRole = "learner" | "contributor" | "administrator";

type LoginResponse = {
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

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email.trim(),
          password: formData.password,
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        let message = "Invalid email or password.";

        if (data !== null && typeof data === "object") {
          if ("message" in data && typeof data.message === "string") {
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

      const isStaff =
        loginData.learner.role === "administrator" ||
        loginData.learner.role === "contributor";

      const destination = isStaff ? "/admin/questions" : "/categories";

      setToken(loginData.access_token, destination);
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

  return (
    <div className="space-y-5 text-brand-text">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-brand-text">
          Sign in to your account
        </h2>
        <p className="text-sm text-brand-text/70">
          Enter your credentials to continue.
        </p>
      </div>

      {authError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          role="alert"
        >
          {authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormInput
          label="Email address"
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          value={formData.email}
          onChange={handleChange}
          onBlur={() => handleBlur("email")}
          error={touched.email ? errors.email : undefined}
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
          error={touched.password ? errors.password : undefined}
        />

        <div className="pt-1">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full cursor-pointer rounded-md bg-brand-accent px-6 text-sm font-semibold text-brand-text shadow-xs transition-colors hover:bg-brand-accent-tint focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </div>

        <div className="space-y-2 border-t border-brand-border pt-4 text-sm text-brand-text/75">
          <p>
            <Link
              href="/forgot-password"
              className="font-semibold text-brand-text underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          <p>
            New to the platform?{" "}
            <Link
              href="/register"
              className="font-semibold text-brand-text underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
