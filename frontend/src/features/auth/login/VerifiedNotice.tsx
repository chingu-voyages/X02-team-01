"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// Pure mapping so the messages are testable without a router context.
export function verificationNoticeMessage(
  params: URLSearchParams,
): { tone: "success" | "warning"; message: string } | null {
  if (params.get("verified") === "1") {
    return {
      tone: "success",
      message: "Email verified — your account is ready. Please sign in.",
    };
  }
  if (params.get("verification") === "invalid") {
    return {
      tone: "warning",
      message:
        "That verification link is invalid, expired, or already used. Sign in below, or request a new email from the register page.",
    };
  }
  return null;
}

function VerificationBanner() {
  const params = useSearchParams();
  const notice = verificationNoticeMessage(params);
  if (!notice) return null;

  const toneClasses =
    notice.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <p
      role="status"
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${toneClasses}`}
    >
      {notice.message}
    </p>
  );
}

// The emailed verification link lands here after the backend redirects:
// /login?verified=1 (success) or /login?verification=invalid (bad token).
export default function VerifiedNotice() {
  return (
    <Suspense fallback={null}>
      <VerificationBanner />
    </Suspense>
  );
}
