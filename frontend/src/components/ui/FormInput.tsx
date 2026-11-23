"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** JHEP-124: renders an Eye/EyeOff button inside the field that
   *  toggles `password` <-> `text`, so users can verify what they type
   *  (registration, sign-in, and password reset). Opt-in — other
   *  FormInput usages are unaffected. Keyboard-accessible by design:
   *  a real button with aria-label + aria-pressed. */
  passwordToggle?: boolean;
}

export default function FormInput({
  label,
  id,
  name,
  type = "text",
  error,
  passwordToggle = false,
  ...props
}: FormInputProps) {
  // Fallback to name if id isn't explicitly passed
  const inputId = id || name;
  const errorId = `${inputId}-error`;
  const [showPassword, setShowPassword] = useState(false);

  const isToggleable = passwordToggle && type === "password";
  const effectiveType = isToggleable && showPassword ? "text" : type;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-gray-700 mb-1.5"
      >
        {label}
      </label>
      <div className={isToggleable ? "relative" : undefined}>
        <input
          id={inputId}
          name={name}
          type={effectiveType}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={`w-full bg-white rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-200 focus:outline-none focus:ring-2 ${
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/10"
              : "border-gray-300 focus:border-gray-900 focus:ring-gray-900/10"
          } ${isToggleable ? "pr-11" : ""}`}
          {...props}
        />
        {isToggleable && (
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hover:cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-sm"
          >
            {showPassword ? (
              <EyeOff className="w-4.5 h-4.5" aria-hidden="true" />
            ) : (
              <Eye className="w-4.5 h-4.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
