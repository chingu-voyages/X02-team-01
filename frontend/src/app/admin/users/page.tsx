"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  changeAdminUserRole,
  getAdminUsers,
  updateGradingPermissions,
  type AdminUserItem,
  type AdminUsersPage,
  type ManageableUserRole,
} from "@/lib/admin-users-api";
import AdminUserRow from "../../../features/admin/AdminUserRow";
import RoleChangeDialog from "../../../features/admin/RoleChangeDialog";

type LoadStatus = "loading" | "ready" | "error";

export default function AdminUsersPage() {
  const { token, ready, handleError } = useDemoSession();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [page, setPage] = useState<AdminUsersPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // JHEP-125 AC1: every role change requires an explicit confirmation
  // before the request is sent.
  const [pendingChange, setPendingChange] = useState<{
    user: AdminUserItem;
    role: ManageableUserRole;
  } | null>(null);

  // JHEP-192: the written-response grading-permissions flow — a
  // second independent dialog for Contributor accounts.
  const [pendingPermissions, setPendingPermissions] = useState<{
    user: AdminUserItem;
  } | null>(null);
  const [permissionInFlight, setPermissionInFlight] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeInFlight, setChangeInFlight] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const load = useCallback(
    async (search: string, activeToken: string) => {
      setStatus("loading");
      setLoadError(null);
      try {
        const result = await getAdminUsers(activeToken, search);
        setPage(result);
        setStatus("ready");
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          handleError(error);
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "Unable to load accounts",
        );
        setStatus("error");
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;

    getAdminUsers(token, query)
      .then((data) => {
        if (cancelled) return;
        setPage(data);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          handleError(error);
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "Unable to load accounts",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, query, handleError]);

  if (!ready || !token || status === "loading") {
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Checking session...
      </p>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-md border border-brand-border bg-white p-6 shadow-xs">
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {loadError}
        </p>

        <button
          type="button"
          onClick={() => void load(query, token)}
          className="mt-4 cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint"
        >
          Retry
        </button>
      </div>
    );
  }

  const confirmChange = async () => {
    if (!pendingChange || !token) return;

    setChangeInFlight(true);
    setChangeError(null);
    try {
      const result = await changeAdminUserRole(
        token,
        pendingChange.user.id,
        pendingChange.role,
      );
      setPendingChange(null);
      setSuccessNote(
        result.action === "promoted"
          ? `${result.user.fullName} is now a Contributor.`
          : `${result.user.fullName} is now a Learner.`,
      );
      await load(query, token);
    } catch (error) {
      setChangeError(
        error instanceof ApiError
          ? error.message
          : "Unable to change the role",
      );
    } finally {
      setChangeInFlight(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl">
          Users &amp; Access
        </h1>
        <p className="text-sm text-brand-text/70">
          Locate an existing account and change its role between Learner and
          Contributor. Changes take effect immediately; history and authored
          content are never touched.
        </p>
      </header>

      <form
        className="flex gap-3 rounded-md border border-brand-border bg-white p-4 shadow-xs"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (token) void load(query, token);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email or name"
          aria-label="Search accounts by email or name"
          className="flex-1 rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm text-brand-text focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        />
        <button
          type="submit"
          className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint"
        >
          Search
        </button>
      </form>

      {successNote && (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {successNote}
        </p>
      )}

      {page && page.items.length === 0 && (
        <p className="rounded-md border border-brand-border bg-white p-4 text-sm text-brand-text/70 shadow-xs">
          No accounts match “{query}”.
        </p>
      )}

      {page && page.items.length > 0 && (
        <ul className="space-y-3">
          {page.items.map((user) => (
            <AdminUserRow
              key={user.id}
              user={user}
              onRequestRoleChange={(targetUser, role) => {
                setChangeError(null);
                setSuccessNote(null);
                setPendingChange({ user: targetUser, role });
              }}
              onRequestGradingPermissions={(targetUser) => {
                setPermissionError(null);
                setSuccessNote(null);
                setPendingPermissions({ user: targetUser });
              }}
            />
          ))}
        </ul>
      )}

      {pendingChange && (
        <RoleChangeDialog
          user={pendingChange.user}
          targetRole={pendingChange.role}
          isSubmitting={changeInFlight}
          error={changeError}
          onCancel={() => {
            setPendingChange(null);
            setChangeError(null);
          }}
          onConfirm={() => void confirmChange()}
        />
      )}
    </section>
  );
}