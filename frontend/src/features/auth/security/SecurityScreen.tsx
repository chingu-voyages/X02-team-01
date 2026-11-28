"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useAuth, useDemoSession } from "@/features/auth/AuthProvider";
import { isEnrollmentOnlyToken } from "@/features/auth/session-scope";

type MfaStatus = {
  configured: boolean;
  available: boolean;
  mandatory: boolean;
  enrolled: boolean;
};
type SetupData = { otpauth_uri: string; secret: string };
type Confirmation = { recovery_codes: string[] };

class SecurityRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function securityRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/auth/mfa/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = "Unable to complete the security request. Try again.";
    if (response.status === 401) {
      message = "Your security session has expired or changed. Sign in again to continue.";
    } else if (data && typeof data === "object") {
      if ("message" in data && typeof data.message === "string") message = data.message;
      else if ("detail" in data && typeof data.detail === "string") message = data.detail;
      else if ("detail" in data && data.detail && typeof data.detail === "object" && "message" in data.detail && typeof data.detail.message === "string") message = data.detail.message;
    }
    throw new SecurityRequestError(response.status, message);
  }
  return data as T;
}

const primary = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
const secondary = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto";

function SecurityWorkspace({ token, logout }: { token: string; logout: () => void }) {
  const restricted = isEnrollmentOnlyToken(token);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [error, setError] = useState("");
  const [mustSignIn, setMustSignIn] = useState(false);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    securityRequest<MfaStatus>(token, "status", { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setError("");
        setMustSignIn(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Unable to load security settings.");
        setMustSignIn(caught instanceof SecurityRequestError && [401, 403].includes(caught.status));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, retryKey]);

  useEffect(() => {
    if (recoveryCodes) recoveryHeading.current?.focus();
  }, [recoveryCodes]);

  function retryStatus() {
    setLoading(true);
    setError("");
    setRetryKey((value) => value + 1);
  }

  function displayError(caught: unknown) {
    setError(caught instanceof Error ? caught.message : "Network error. Try again.");
    setMustSignIn(caught instanceof SecurityRequestError && [401, 403, 409].includes(caught.status));
  }

  async function startSetup() {
    if (inFlight.current || !status?.configured || !status.available || status.enrolled) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setCodeError("");
    try {
      const result = await securityRequest<SetupData>(token, "enroll/setup", { method: "POST" });
      setSetup(result);
      setCode("");
      // Manual setup remains available even if local QR rendering fails.
      const image = await QRCode.toDataURL(result.otpauth_uri, { width: 220, margin: 2 }).catch(() => null);
      setQr(image);
    } catch (caught: unknown) {
      displayError(caught);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !setup || mustSignIn) return;
    const normalized = code.trim();
    if (!/^\d{6}$/.test(normalized)) {
      setCodeError("Enter all six digits from your authenticator.");
      codeInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    setCodeError("");
    try {
      const result = await securityRequest<Confirmation>(token, "enroll/verify", {
        method: "POST",
        body: JSON.stringify({ code: normalized }),
      });
      // Confirmation invalidates this token. Keep the receipt in memory
      // until the user explicitly finishes saving their recovery codes.
      setRecoveryCodes(result.recovery_codes);
      setSetup(null);
      setQr(null);
      setCode("");
    } catch (caught: unknown) {
      if (caught instanceof SecurityRequestError && caught.status === 400) {
        setCodeError(caught.message);
        codeInput.current?.focus();
      } else displayError(caught);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full min-w-0 max-w-2xl space-y-5 px-4 py-6 text-brand-text sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-text/65">The Job Hackers · Account</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Account security</h1>
          <p className="mt-2 text-sm text-brand-text/75">Protect your account with an authenticator app.</p>
        </div>
        {!recoveryCodes && <button type="button" className={secondary} onClick={logout} disabled={busy}>Sign out</button>}
      </header>

      {restricted && !recoveryCodes && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Administrator setup required</p>
            <p className="mt-1">Complete two-factor enrollment and sign in again before using administrator features. This temporary setup session expires after 15 minutes.</p>
          </div>
        </div>
      )}

      {recoveryCodes ? (
        <div className="space-y-4 rounded-md border border-green-200 bg-white p-4 shadow-xs sm:p-6">
          <CheckCircle2 className="size-7 text-green-700" aria-hidden="true" />
          <h2 ref={recoveryHeading} tabIndex={-1} className="text-xl font-bold outline-none">Two-factor authentication enabled</h2>
          <p className="text-sm">Save these recovery codes somewhere secure. Each works once and this is the only time they will be displayed.</p>
          <ul aria-label="Recovery codes" className="grid min-w-0 gap-2 rounded-md border border-brand-border bg-brand-surface p-3 font-mono text-sm min-[360px]:grid-cols-2">
            {recoveryCodes.map((value) => <li key={value} className="wrap-anywhere">{value}</li>)}
          </ul>
          <label className="flex min-h-11 items-start gap-3 text-sm font-medium">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-primary" />
            I have saved my recovery codes securely.
          </label>
          <p className="text-sm text-brand-text/70">Your previous session has been invalidated. Sign in with your password and authenticator to continue.</p>
          <button type="button" className={primary} disabled={!saved} onClick={logout}>Sign in again</button>
        </div>
      ) : (
        <div className="min-w-0 space-y-4 rounded-md border border-brand-border bg-white p-4 shadow-xs sm:p-6" aria-busy={loading || busy}>
          <h2 className="text-lg font-semibold">Two-factor authentication (TOTP)</h2>
          {loading && <p role="status" className="text-sm text-brand-text/70">Checking security settings...</p>}
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 wrap-anywhere">{error}</div>}
          {mustSignIn ? (
            <button type="button" className={primary} onClick={logout}>Sign in again</button>
          ) : !loading && !status ? (
            <button type="button" className={secondary} onClick={retryStatus}>Retry</button>
          ) : !loading && status && (
            <>
              {!status.configured && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Two-factor authentication is not configured for this deployment. Contact the platform administrator to configure MFA before proceeding.</div>}
              {status.enrolled ? (
                <p role="status" className="flex items-start gap-2 text-sm text-green-800"><CheckCircle2 aria-hidden="true" className="size-5 shrink-0" /> Two-factor authentication is enabled. Your authenticator and unused recovery codes protect future sign-ins.</p>
              ) : !status.available ? (
                <p className="text-sm text-brand-text/70">Enrollment is not available for your current role.</p>
              ) : !setup ? (
                <>
                  <p className="text-sm">{status.mandatory ? "Two-factor enrollment is required for administrators." : "Add a second factor to your account."} Use an authenticator app to generate your sign-in codes.</p>
                  <button type="button" onClick={() => void startSetup()} disabled={busy || !status.configured} className={primary}>{busy ? "Preparing setup..." : "Set up two-factor authentication"}</button>
                </>
              ) : (
                <div className="space-y-4">
                  <h3 className="font-semibold">1. Add the account to your authenticator</h3>
                  {qr && (
                    // The QR is generated in memory from the account's enrollment URI.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="QR code containing your two-factor enrollment details" width={220} height={220} className="mx-auto h-auto max-w-full rounded-md border bg-white" />
                  )}
                  <details open={!qr} className="min-w-0 rounded-md border border-brand-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Enter the setup key manually</summary>
                    <code className="mt-2 block break-all rounded bg-brand-surface p-2 text-sm">{setup.secret}</code>
                  </details>
                  <p className="text-xs text-brand-text/70">Keep the setup key private. Anyone with it can generate your authenticator codes.</p>
                  <h3 className="font-semibold">2. Verify your authenticator</h3>
                  <form onSubmit={(event) => void confirmSetup(event)} noValidate className="space-y-3">
                    <label className="block text-sm font-medium" htmlFor="enroll-code">Authenticator code</label>
                    <input ref={codeInput} id="enroll-code" name="enroll-code" value={code} onChange={(event) => { setCode(event.target.value); setCodeError(""); }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy} aria-invalid={Boolean(codeError)} aria-describedby={codeError ? "enroll-code-error" : undefined} className="min-h-11 w-full min-w-0 rounded-md border border-brand-border px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2" />
                    {codeError && <p id="enroll-code-error" role="alert" className="text-sm text-red-700">{codeError}</p>}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="submit" className={primary} disabled={busy}>{busy ? "Verifying..." : "Confirm enrollment"}</button>
                      <button type="button" className={secondary} disabled={busy} onClick={() => { setSetup(null); setQr(null); setCode(""); setCodeError(""); setError(""); }}>Cancel setup</button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function SecurityScreen() {
  const { token, ready } = useDemoSession();
  const { logout } = useAuth();
  if (!ready || !token) return <p role="status" className="p-6 text-sm">Checking session...</p>;
  return <SecurityWorkspace key={token} token={token} logout={logout} />;
}
