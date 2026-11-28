"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api-client";
import { getAdministratorPromotionEligibility, promoteAdministrator, type AdministratorPromotionEligibility, type AdministratorPromotionResult } from "@/lib/admin-promotion-api";
import type { AdminUserItem } from "@/lib/admin-users-api";
import AccessDialog, { AccessError, accessActions, accessPrimary, accessSecondary } from "./AccessDialog";

type Preview = { revision: number; data: AdministratorPromotionEligibility | null; error: string | null };
type Props = {
  token: string;
  user: AdminUserItem;
  onCancel: (refreshList: boolean) => void;
  onSuccess: (result: AdministratorPromotionResult) => void;
  onUnauthorized: (error: ApiError) => void;
  onSignInAgain: () => void;
};

function apiCode(error: ApiError): string | null {
  const detail = error.detail;
  return detail && typeof detail === "object" && "code" in detail && typeof detail.code === "string" ? detail.code : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
    return error.message;
  }
  return "Unable to reach the server. Check your connection and try again.";
}

export default function AdministratorPromotionDialog({ token, user, onCancel, onSuccess, onUnauthorized, onSignInAgain }: Props) {
  const formId = useId();
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const problemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    getAdministratorPromotionEligibility(token, user.id).then((data) => {
      if (cancelled) return;
      setPreview({ revision, data, error: null });
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.status === 401) onUnauthorized(error);
      setPreview({ revision, data: null, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [token, user.id, revision, onUnauthorized]);
  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const current = preview?.revision === revision ? preview : null;
  const eligibility = current?.data;
  const target = eligibility?.target ?? user;
  const fresh = Boolean(eligibility?.recent_authentication) && !reauthenticate;
  const ready = Boolean(eligibility?.eligible) && fresh && !needsRefresh && !busy;
  const valid = email.trim().toLowerCase() === target.email.toLowerCase() && reason.trim().length > 0 && reason.trim().length <= 1000 && confirmed;

  function refresh() {
    if (inFlight.current) return;
    setProblem(null);
    setNeedsRefresh(false);
    setReauthenticate(false);
    setEmail("");
    setReason("");
    setConfirmed(false);
    setRevision((value) => value + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    setAttempted(true);
    try {
      const result = await promoteAdministrator(token, target.id, { confirmation_email: email.trim(), reason: reason.trim(), confirm: true });
      if (mounted.current) onSuccess(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized(error);
        setNeedsRefresh(true);
        setProblem("Your session changed. Sign in again before continuing.");
      } else if (error instanceof ApiError && apiCode(error) === "ADMIN_PROMOTION_REAUTH_REQUIRED") {
        setReauthenticate(true);
        setProblem(errorMessage(error));
      } else if (error instanceof ApiError && apiCode(error) === "ADMIN_PROMOTION_EMAIL_MISMATCH") {
        setEmail("");
        setConfirmed(false);
        setNeedsRefresh(true);
        setProblem(`${errorMessage(error)} Refresh eligibility before trying again.`);
      } else {
        setNeedsRefresh(true);
        setProblem(error instanceof ApiError && error.status < 500
          ? `${errorMessage(error)} Refresh eligibility before trying again.`
          : "We could not confirm whether access changed. Refresh eligibility to check the current account before trying again.");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function cancel() {
    if (!inFlight.current) onCancel(attempted);
  }

  return (
    <AccessDialog title="Grant Administrator access" busy={busy} onCancel={cancel}>
      <div className="min-w-0 rounded-md border border-brand-border bg-brand-surface p-3 [overflow-wrap:anywhere]">
        <p className="font-semibold">{target.fullName || "Unnamed account"}</p>
        <p className="text-sm text-brand-text/80">{target.email}</p>
        <p className="mt-1 text-xs font-medium">Current role: {target.role}</p>
      </div>
      {!current && <p role="status" className="text-sm text-brand-text/75">Checking account eligibility…</p>}
      {current?.error && <AccessError message={current.error} />}
      {eligibility && (
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold">Account eligibility</h3>
          <p>Email: {target.is_verified ? "Verified" : "Not verified"}</p>
          <p>Two-factor enrollment: {eligibility.mfa_enrolled ? "Confirmed" : "Not enabled"}</p>
          {eligibility.eligible ? <p className="font-medium text-emerald-800">All account eligibility checks passed.</p> : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <p className="font-semibold">Account not eligible</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{eligibility.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
            </div>
          )}
          {eligibility.eligible && !fresh && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <p className="font-semibold">Fresh sign-in required</p>
              <p className="mt-1">Sign in again using your password and two-factor verification. Then return to Users &amp; Access and select this account again. Authentication must be recent (within {Math.ceil(eligibility.authentication_max_age_seconds / 60)} minutes).</p>
            </div>
          )}
        </div>
      )}
      {problem && <div ref={problemRef} tabIndex={-1} className="outline-none"><AccessError message={problem} /></div>}
      {eligibility?.eligible && fresh && (
        <form id={formId} onSubmit={(event) => void submit(event)} className="min-w-0 space-y-4">
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">This grants full administrative access, including user management, question publication and exam configuration. The recipient’s existing privileged sessions will be invalidated, and the change will be recorded in the audit trail.</p>
          <fieldset disabled={!ready} className="min-w-0 space-y-3 disabled:opacity-70">
            <legend className="sr-only">Confirm administrator promotion</legend>
            <label className="block space-y-1 text-sm font-medium"><span>Reason for granting access</span><textarea rows={3} maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} className="block w-full min-w-0 resize-y rounded-md border border-brand-border p-3 focus-visible:outline-2" /></label>
            <p className="text-right text-xs text-brand-text/65">{reason.length}/1000</p>
            <label className="block space-y-1 text-sm font-medium"><span>Confirm the account email</span><input type="text" inputMode="email" autoComplete="off" spellCheck={false} maxLength={255} required value={email} onChange={(event) => setEmail(event.target.value)} className="block min-h-11 w-full min-w-0 rounded-md border border-brand-border px-3 py-2 focus-visible:outline-2" /></label>
            {email.trim() && email.trim().toLowerCase() !== target.email.toLowerCase() && <p className="text-xs text-red-800">Enter the selected account’s email address.</p>}
            <label className="flex min-w-0 items-start gap-3 rounded-md border border-brand-border p-3 text-sm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#3d4145]" /><span>I understand that this grants full administrator privileges.</span></label>
          </fieldset>
        </form>
      )}
      <div className={accessActions}>
        <button type="button" data-dialog-cancel disabled={busy} onClick={cancel} className={accessSecondary}>Cancel</button>
        {eligibility?.eligible && !fresh && <button type="button" className={accessPrimary} onClick={onSignInAgain}>Sign in again</button>}
        {current && (needsRefresh || !eligibility?.eligible || current.error) && <button type="button" disabled={busy} className={accessSecondary} onClick={refresh}>Refresh eligibility</button>}
        {eligibility?.eligible && fresh && <button type="submit" form={formId} disabled={!ready || !valid} className={accessPrimary}>{busy ? "Granting access…" : "Confirm Administrator promotion"}</button>}
      </div>
    </AccessDialog>
  );
}
