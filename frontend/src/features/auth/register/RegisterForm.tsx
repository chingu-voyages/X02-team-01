"use client";

import Card from "@/components/ui/Card";
import PageHeader from "@/components/layouts/PageHeader";
import { Button } from "@/components/ui/button";
import FormInput from "@/components/ui/FormInput";
import Link from "next/link";
import { useState } from "react";

export default function RegisterForm() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    confirmEmail: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);          // ALIGNMENT: double-click guard
  const [pendingEmail, setPendingEmail] = useState<string | null>(null); // ALIGNMENT: pending-verification state
  const [resendMessage, setResendMessage] = useState("");

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Clear error when user starts typing again
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  // Password strength calculation
  const calculatePasswordStrength = (pass: string) => {
    let score = 0;
    if (!pass) return 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score;
  };

  const passwordStrength = calculatePasswordStrength(formData.password);

  const getStrengthLabel = (pass: string, score: number) => {
    if (pass.length > 0 && pass.length < 8) {
      return {
        text: "Minimum 8 characters.",
        color: "bg-transparent",
      };
    }
    switch (score) {
      case 1:
        return { text: "Weak", color: "bg-red-500" };
      case 2:
        return { text: "Fair", color: "bg-yellow-500" };
      case 3:
        return { text: "Good", color: "bg-blue-500" };
      case 4:
        return { text: "Strong", color: "bg-green-500" };
      default:
        return { text: "", color: "bg-transparent" };
    }
  };

  const strengthInfo = getStrengthLabel(formData.password, passwordStrength);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all fields as touched on submit so all errors render if invalid
    setTouched({
      fullName: true,
      email: true,
      confirmEmail: true,
      password: true,
      confirmPassword: true,
    });

    // Client validation checks
    const newErrors: Record<string, string> = {};
    if (!formData.fullName.trim())
      newErrors.fullName = "Full name is required.";
    if (!formData.email.trim()) newErrors.email = "Email is required.";
    if (formData.email !== formData.confirmEmail)
      newErrors.confirmEmail = "Email addressess do not match.";
    if (!formData.password.trim()) newErrors.password = "Password is required.";
    else if (formData.password.length < 8)
      newErrors.password = "Password must be at least 8 characters.";
    else if (!/[A-Z]/.test(formData.password))
      newErrors.password = "Password must contain an uppercase letter.";
    else if (!/[a-z]/.test(formData.password))
      newErrors.password = "Password must contain a lowercase letter.";
    else if (!/[0-9]/.test(formData.password))
      newErrors.password = "Password must contain a digit.";
    if (formData.password !== formData.confirmPassword)
      newErrors.confirmPassword = "Passwords do not match.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // isSubmitting guard: a double-click must not fire a second POST
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Submit logic
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          fullName: formData.fullName,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // coded top-level {code, message} bodies (JHEP-24 backend)
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Registration failed",
        );
      }

      // AC2: pending-verification state (login arrives with JHEP-25)
      setPendingEmail(formData.email);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Registration failed";
      // surface the exact backend guidance (e.g. EMAIL_TAKEN / WEAK_PASSWORD)
      setErrors({ email: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  async function handleResend() {
    if (isSubmitting || !pendingEmail) return;
    setIsSubmitting(true);
    setResendMessage("");
    try {
      const response = await fetch("/api/v1/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail }),
      });
      const data = await response.json();
      setResendMessage(
        data.message ||
          "If the account exists and is unverified, a verification email has been sent.",
      );
    } catch (error) {
      setResendMessage(
        error instanceof Error ? error.message : "Unable to resend the email.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ALIGNMENT: pending-verification state (backend 201 contract)
  if (pendingEmail) {
    return (
      <Card aria-live="polite">
        <h2 className="text-xl font-semibold mb-2">Check your email</h2>
        <p className="text-sm text-gray-700">
          We sent a one-time verification link to{" "}
          <strong>{pendingEmail}</strong>. The link expires in 24 hours —
          click it to activate your account before signing in.
        </p>

        {resendMessage ? (
          <p className="mt-2 text-sm text-gray-600" role="status">
            {resendMessage}
          </p>
        ) : null}

        <div className="flex gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={isSubmitting}
            className="hover:cursor-pointer py-5 px-4 text-base border border-gray-300 rounded-sm"
          >
            {isSubmitting ? "Sending..." : "Resend verification email"}
          </Button>
        </div>

        <p className="text-sm text-gray-600 mt-4">
          Already registered?{" "}
          <Link href="#" className="text-primary hover:underline font-medium">
            Sign in
          </Link>{" "}
          once your account is verified.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Full name */}
      <FormInput
        label="Full name"
        id="fullName"
        name="fullName"
        type="text"
        placeholder="What is your name?"
        value={formData.fullName}
        onChange={handleChange}
        onBlur={() => handleBlur("fullName")}
        error={touched.fullName ? errors.fullName : undefined}
      />

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

      {/* Email confirmation */}
      <FormInput
        label="Confirm email"
        id="confirmEmail"
        name="confirmEmail"
        type="email"
        placeholder="Please confirm your email address."
        value={formData.confirmEmail}
        onChange={handleChange}
        onBlur={() => handleBlur("confirmEmail")}
        error={touched.confirmEmail ? errors.confirmEmail : undefined}
      />

      {/* Password */}
      <div className="relative">
        <FormInput
          label="Create password"
          id="password"
          name="password"
          type="password"
          placeholder="At least 8 characters"
          value={formData.password}
          onChange={handleChange}
          onBlur={() => handleBlur("password")}
          error={touched.password ? errors.password : undefined}
        />

        {/* Password strength indicator */}
        {formData.password && (
          <div className="absolute right-3 top-8.5 flex items-center gap-1.5 pointer-events-none text-xs font-medium text-gray-500 bg-white px-1">
            <span className={`w-10 h-2 rounded-full ${strengthInfo.color}`} />
            <span>{strengthInfo.text}</span>
          </div>
        )}
      </div>

      {/* Password confirmation */}
      <FormInput
        label="Confirm password"
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        placeholder="Please confirm your password."
        value={formData.confirmPassword}
        onChange={handleChange}
        onBlur={() => handleBlur("confirmPassword")}
        error={touched.confirmPassword ? errors.confirmPassword : undefined}
      />
      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="self-start py-6 px-4 text-base hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </Button>
        <p className="text-sm text-gray-600">
          Already registered?{" "}
          <Link href="#" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
