"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth, useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { changeAdminUserRole, getAdminUsers, updateGradingPermissions, type AdminUserItem, type AdminUsersPage as UsersPage, type ManageableUserRole } from "@/lib/admin-users-api";
import { AccessError, accessPrimary, accessSecondary } from "./AccessDialog";
import AdminUserRow from "./AdminUserRow";
import AdministratorPromotionDialog from "./AdministratorPromotionDialog";
import GradingPermissionsDialog, { type GradingSelection } from "./GradingPermissionsDialog";
import RoleChangeDialog from "./RoleChangeDialog";

const defaultLimit = 50;
type Request = { query: string; offset: number; limit: number };
type ListResult = { request: Request; page: UsersPage | null; error: string | null; forbidden: boolean };
type Dialog = { kind: "role"; user: AdminUserItem; role: ManageableUserRole } | { kind: "grading" | "promotion"; user: AdminUserItem };

function UsersWorkspace({ token, handleError, logout }: { token: string; handleError: (error: unknown) => void; logout: () => void }) {
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState<Request>({ query: "", offset: 0, limit: defaultLimit });
  const [result, setResult] = useState<ListResult | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const mutation = useRef(false);
  const mounted = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = request.offset === 0 && request.limit === defaultLimit
      ? getAdminUsers(token, request.query)
      : getAdminUsers(token, request.query, { limit: request.limit, offset: request.offset });
    load.then((page) => {
      if (cancelled) return;
      setResult({ request, page, error: null, forbidden: false });
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.status === 401) handleError(error);
      setResult({ request, page: null, error: error instanceof Error ? error.message : "Unable to load accounts", forbidden: error instanceof ApiError && error.status === 403 });
    });
    return () => { cancelled = true; };
  }, [request, token, handleError]);
  useEffect(() => {
    if (!dialog && opener.current) {
      if (success || !opener.current.isConnected) heading.current?.focus();
      else opener.current.focus();
      opener.current = null;
    }
  }, [dialog, success]);

  const current = result?.request === request ? result : null;
  const page = current?.page;
  const reload = () => setRequest((previous) => ({ ...previous }));

  function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(null);
    setRequest({ query: query.trim(), offset: 0, limit: defaultLimit });
  }

  function clearSearch() {
    setQuery("");
    setSuccess(null);
    setRequest({ query: "", offset: 0, limit: defaultLimit });
    search.current?.focus();
  }

  function open(next: Dialog) {
    if (dialog || mutation.current) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setProblem(null);
    setNeedsRefresh(false);
    setSuccess(null);
    setDialog(next);
  }

  function close(refresh = false) {
    if (mutation.current) return;
    setDialog(null);
    setProblem(null);
    setNeedsRefresh(false);
    if (refresh) {
      reload();
    }
  }

  function completed(message: string) {
    setDialog(null);
    setSuccess(message);
    setProblem(null);
    setNeedsRefresh(false);
    reload();
  }

  async function change(selection?: GradingSelection) {
    if (!dialog || dialog.kind === "promotion" || mutation.current || needsRefresh) return;
    if (dialog.kind === "grading" && !selection) return;
    mutation.current = true;
    setBusy(true);
    setProblem(null);
    try {
      if (dialog.kind === "role") {
        const changed = await changeAdminUserRole(token, dialog.user.id, dialog.role);
        if (mounted.current) completed(`${changed.user.fullName} is now a ${changed.user.role === "contributor" ? "Contributor" : "Learner"}.`);
      } else if (selection) {
        const changed = await updateGradingPermissions(token, dialog.user.id, selection);
        if (mounted.current) completed(`${changed.user.fullName}'s grading permissions were saved.`);
      }
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        setNeedsRefresh(true);
        setProblem(error.message);
      } else if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        setProblem(`${error.message} Close this dialog to refresh the current account.`);
        setNeedsRefresh(true);
      } else if (!(error instanceof ApiError) || error.status >= 500) {
        setProblem("We could not confirm the change. Close this dialog to refresh the account before trying again.");
        setNeedsRefresh(true);
      } else {
        setProblem(error.message);
      }
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full min-w-0 max-w-5xl space-y-5 text-brand-text [overflow-wrap:anywhere]">
      <div inert={dialog !== null} className="min-w-0 space-y-5">
        <header className="space-y-2">
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none sm:text-3xl">Users &amp; Access</h1>
          <p className="text-sm text-brand-text/75">Find accounts, manage Contributor access and grading permissions, or grant Administrator access through a separate security check.</p>
          <details className="rounded-md border border-brand-border bg-white p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2">How to onboard an administrator</summary>
            <p className="mt-2 leading-6">Ask the person to register with their own password and verify their email. Grant Contributor access, have them enable two-factor authentication in Account Security, then return here to review their eligibility. Administrator promotion requires a recent password and MFA sign-in by you.</p>
          </details>
        </header>
        <form className="flex min-w-0 flex-col gap-2 rounded-md border border-brand-border bg-white p-3 shadow-xs sm:flex-row sm:items-center" onSubmit={runSearch}>
          <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by email or name" aria-label="Search accounts by email or name" className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm focus-visible:outline-2" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={accessPrimary}>Search</button>
            {(query || request.query) && <button type="button" className={accessSecondary} onClick={clearSearch}>Clear search</button>}
          </div>
        </form>
        {success && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
        {!current && <p role="status" className="rounded-md border border-brand-border bg-white p-4 text-sm">Loading accounts…</p>}
        {current?.error && <div className="space-y-3 rounded-md border border-brand-border bg-white p-4"><AccessError message={current.error} />{!current.forbidden && <button type="button" className={accessSecondary} onClick={reload}>Retry</button>}</div>}
        {page && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-brand-text/75">
              <p role="status">Showing {page.items.length ? page.offset + 1 : 0}–{page.items.length ? page.offset + page.items.length : 0} of {page.total} accounts{request.query ? ` matching “${request.query}”` : ""}</p>
              <button type="button" className={accessSecondary} onClick={reload}>Refresh accounts</button>
            </div>
            {page.items.length === 0 ? <div className="space-y-3 rounded-md border border-brand-border bg-white p-4 text-sm"><p>{request.query ? `No accounts match “${request.query}”.` : "No accounts found on this page."}</p>{request.query && <button type="button" className={accessSecondary} onClick={clearSearch}>Clear filters</button>}</div> : (
              <ul aria-label="User accounts" className="min-w-0 space-y-3">
                {page.items.map((user) => <AdminUserRow key={user.id} user={user} onRequestRoleChange={(target, role) => open({ kind: "role", user: target, role })} onRequestGradingPermissions={(target) => open({ kind: "grading", user: target })} onRequestPromotion={(target) => open({ kind: "promotion", user: target })} />)}
              </ul>
            )}
            <nav aria-label="Account pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" className={accessSecondary} disabled={page.offset === 0} onClick={() => setRequest({ query: request.query, offset: Math.max(0, page.offset - page.limit), limit: page.limit })}>Previous page</button>
              <span>Page {Math.floor(page.offset / page.limit) + 1} of {Math.max(1, Math.ceil(page.total / page.limit))}</span>
              <button type="button" className={accessSecondary} disabled={page.offset + page.limit >= page.total} onClick={() => setRequest({ query: request.query, offset: page.offset + page.limit, limit: page.limit })}>Next page</button>
            </nav>
          </>
        )}
      </div>
      {dialog?.kind === "role" && <RoleChangeDialog user={dialog.user} targetRole={dialog.role} isSubmitting={busy} error={problem} needsRefresh={needsRefresh} onCancel={() => close(needsRefresh)} onConfirm={() => void change()} />}
      {dialog?.kind === "grading" && <GradingPermissionsDialog user={dialog.user} isSubmitting={busy} error={problem} needsRefresh={needsRefresh} onCancel={() => close(needsRefresh)} onSave={(selection) => void change(selection)} />}
      {dialog?.kind === "promotion" && <AdministratorPromotionDialog token={token} user={dialog.user} onCancel={close} onUnauthorized={handleError} onSignInAgain={logout} onSuccess={(promotion) => completed(`${promotion.user.fullName} is now an Administrator. Their previous privileged sessions were invalidated; they must sign in again with MFA.`)} />}
    </section>
  );
}

export default function AdminUsersPage() {
  const { token, ready, handleError } = useDemoSession();
  const { logout } = useAuth();
  if (!ready || !token) return <p role="status" className="text-sm text-brand-text/70">Checking session...</p>;
  return <UsersWorkspace key={token} token={token} handleError={handleError} logout={logout} />;
}
