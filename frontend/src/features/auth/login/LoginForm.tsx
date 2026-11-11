"use client";

import FormInput from "@/components/ui/FormInput";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Clear error when user starts typing again
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
    if (authError) {
      setAuthError(null);
    }
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark fields as touched
    setTouched({
      email: true,
      password: true,
    });

    // Client-side validation
    const newErrors: Record<string, string> = {};
    if (!formData.email.trim()) newErrors.email = "Email is required.";
    if (!formData.password.trim()) newErrors.password = "Password is required.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Double-click guard
    if (isSubmitting) return;
    setIsSubmitting(true);
    setAuthError(null);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // AC1: Secure error handling without leaking account existence
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Invalid email or password.",
        );
      }

      // Successful login -> redirect to learner dashboard/exams
      router.push("/exams");
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
      <h2 className="font-bold text-2xl">Sign in to your account</h2>

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
        {/* Email address */}
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

        {/* Password */}
        <FormInput
          label="Password"
          id="password"
          name="password"
          type="password"
          placeholder="Enter your password"
          value={formData.password}
          onChange={handleChange}
          onBlur={() => handleBlur("password")}
          error={touched.password ? errors.password : undefined}
        />

        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="self-start py-6 px-4 text-base hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
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
