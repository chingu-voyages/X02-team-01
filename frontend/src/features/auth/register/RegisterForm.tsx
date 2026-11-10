"use client";

import FormInput from "@/components/ui/FormInput";
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
  const calculatePasswordStrengh = (pass: string) => {
    let score = 0;
    if (!pass) return 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score;
  };

  const passwordStrenth = calculatePasswordStrengh(formData.password);

  const getStrengthLabel = (score: number) => {
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
        return { text: "", color: "bg-gray-200" };
    }
  };

  const strengthInfo = getStrengthLabel(passwordStrenth);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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
        error={errors.fullName}
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
        error={errors.email}
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
        error={errors.confirmEmail}
      />

      {/* Password */}
      <FormInput
        label="Create password"
        id="password"
        name="password"
        type="password"
        placeholder="Enter a password of at least 8 characters. Try including a number, capital letter, and special character for strength."
        value={formData.password}
        onChange={handleChange}
        onBlur={() => handleBlur("password")}
        error={errors.password}
      />

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
        error={errors.confirmPassword}
      />
    </form>
  );
}
