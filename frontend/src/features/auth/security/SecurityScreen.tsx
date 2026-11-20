"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import Navbar from "@/components/layouts/Navbar";
import Card from "@/components/ui/Card";
import FormInput from "@/components/ui/FormInput";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";

// JHEP-109: the Security page — the enrollment trigger (PO-confirmed)
// plus the MFA posture for the signed-in account.
type MfaStatus = {
  configured: boolean;
  available: boolean;
  mandatory: boolean;
  enrolled: boolean;
};

type SetupData = {
  otpauth_uri: string;
  secret: string;
};

type EnrollmentState = "loading" | "ready" | "setup" | "done";

export default function SecurityScreen() {
  const { token, ready, handleError } = useDemoSession();
  const [status, setStatus] = useState<EnrollmentState>("loading");
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const loadStatus = useCallback(
    async (activeToken: string) => {
      try {
        const response = await fetch("/api/v1/auth/mfa/status", {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (!response.ok) {
          throw new Error("Unable to load your security settings");
        }
        const data = (await response.json()) as MfaStatus;
        setMfaStatus(data);
        setStatus("ready");
      } catch (error) {
        if (error instanceof ApiError) {
          handleError(error);
          return;
        }
        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load your security settings",
        );
        setStatus("ready");
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;

    // state updates only after the await (no synchronous setState in
    // the effect); explicit reloads stay in event handlers via loadStatus
    fetch("/api/v1/auth/mfa/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          throw new Error("Unable to load your security settings");
        }
        const data = (await response.json()) as MfaStatus;
        setMfaStatus(data);
        setStatus("ready");
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError) {
          handleError(error);
          return;
        }
        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load your security settings",
        );
        setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, handleError]);

  const startSetup = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/v1/auth/mfa/enroll/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as
        | SetupData
        | { message?: string };
      if (!response.ok || !("otpauth_uri" in data)) {
        const message =
          "message" in data && typeof data.message === "string"
            ? data.message
            : "Unable to start enrollment";
        setPageError(message);
        return;
      }
      const setup = data as SetupData;
      setSetupData(setup);
      setQrDataUrl(
        await QRCode.toDataURL(setup.otpauth_uri, {
          width: 220,
          margin: 1,
        }),
      );
      setStatus("setup");
    } catch {
      setPageError("Unable to start enrollment");
    }
  }, [token]);

  const confirmSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || confirming) return;
    setConfirming(true);
    setPageError(null);
    try {
      const response = await fetch("/api/v1/auth/mfa/enroll/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await response.json()) as {
        recovery_codes?: string[];
        message?: string;
      };
      if (!response.ok || !data.recovery_codes) {
        setPageError(
          data.message ?? "That code didn't match. Try again.",
        );
        return;
      }
      setRecoveryCodes(data.recovery_codes);
      setStatus("done");
    } catch {
      setPageError("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  if (!ready || !token || status === "loading") {
    return (
      <div className="min-h-screen bg-[#f3f4f5]">
        <Navbar />
        <p role="status" className="p-6">
          Checking session...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f5]">
      <Navbar />
      <div className="mx-auto max-w-xl px-4 py-10 space-y-6">
        <h1 className="text-2xl font-bold">Account security</h1>

        {pageError && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {pageError}
          </p>
        )}

        <Card className="p-6">
          <h2 className="font-bold text-lg">
            Two-factor authentication (TOTP)
          </h2>

          {mfaStatus && !mfaStatus.configured && (
            <p className="mt-3 text-sm text-gray-600">
              MFA is not configured on this deployment yet. Ask the
              platform administrator to set
              <code className="mx-1">MFA_ENCRYPTION_KEY</code>.
            </p>
          )}

          {mfaStatus?.enrolled ? (
            <p role="status" className="mt-3 text-sm text-emerald-700">
              ✓ Two-factor authentication is enabled on this account.
              Your authenticator app generates your sign-in codes; your
              recovery codes were shown at enrollment.
            </p>
          ) : mfaStatus && mfaStatus.available ? (
            <>
              <p className="mt-3 text-sm text-gray-600">
                {mfaStatus.mandatory
                  ? "Administrators are required to use two-factor authentication. Set it up below — you'll scan a QR code with an authenticator app (Google Authenticator, Authy, 1Password) and confirm a code."
                  : "Add a second factor to your account: scan a QR code with an authenticator app and confirm a code."}
              </p>
              {status !== "setup" && status !== "done" && (
                <button
                  type="button"
                  onClick={() => void startSetup()}
                  className="mt-4 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a]"
                >
                  Set up two-factor authentication
                </button>
              )}
            </>
          ) : (
            mfaStatus && (
              <p className="mt-3 text-sm text-gray-600">
                Two-factor authentication is not available for this role.
              </p>
            )
          )}

          {status === "setup" && setupData && qrDataUrl && (
            <div className="mt-6 space-y-4">
              <p className="text-sm font-semibold">
                1. Scan this with your authenticator app
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="QR code containing your two-factor enrollment details"
                className="rounded-md border bg-white p-2"
                width={220}
                height={220}
              />
              <p className="text-sm text-gray-600">
                Can&apos;t scan? Enter this secret manually:
              </p>
              <code className="block break-all rounded bg-[#e9ebed] px-3 py-2 text-xs">
                {setupData.secret}
              </code>

              <p className="text-sm font-semibold">
                2. Confirm a 6-digit code from the app
              </p>
              <form onSubmit={confirmSetup} className="space-y-3">
                <FormInput
                  label="Authenticator code"
                  id="enroll-code"
                  name="enroll-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setCode(event.target.value)
                  }
                  required
                />
                <button
                  type="submit"
                  disabled={confirming}
                  className="rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {confirming ? "Verifying..." : "Confirm enrollment"}
                </button>
              </form>
            </div>
          )}

          {status === "done" && recoveryCodes && (
            <div className="mt-6 space-y-3">
              <p
                role="alert"
                className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                Two-factor authentication is now enabled. Store these
                recovery codes safely — they are your way back in if you
                lose your device, and they are shown{" "}
                <strong>only this once</strong>.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-md border bg-white p-4 font-mono text-sm">
                {recoveryCodes.map((recoveryCode) => (
                  <span key={recoveryCode}>{recoveryCode}</span>
                ))}
              </div>
              <p className="text-sm text-gray-600">
                Each code works once at sign-in. Then{" "}
                <a href="/login" className="text-primary underline">
                  sign in
                </a>{" "}
                to try the full flow.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
