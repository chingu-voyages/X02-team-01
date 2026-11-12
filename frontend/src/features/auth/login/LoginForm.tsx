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

      const isStaff =
        loginData.learner.role ===
          "administrator" ||
        loginData.learner.role === "contributor";

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