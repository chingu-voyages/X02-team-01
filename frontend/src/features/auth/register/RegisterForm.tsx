"use client";

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

  const handleSubmit = (e: React.FormEvent) => {
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
    if (formData.password !== formData.confirmPassword)
      newErrors.confirmPassword = "Passwords do not match.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Submit logic comes here later
    console.log("Form submitted successfully:", formData);
  };

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
      <div className="flex flex-col gap-1">
        <Button
          type="submit"
          className="self-start py-6 px-4 text-base hover:cursor-pointer"
        >
          Create account
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
