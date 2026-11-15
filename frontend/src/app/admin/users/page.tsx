"use client";

import { useCallback, useEffect, useState } from "react";

import Navbar from "@/components/layouts/Navbar";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  changeAdminUserRole,
  getAdminUsers,
  type AdminUserItem,
  type AdminUsersPage,
  type ManageableUserRole,
} from "@/lib/admin-users-api";

type LoadStatus = "loading" | "ready" | "error";

function roleBadgeClasses(role: AdminUserItem["role"]): string {
  switch (role) {
    case "administrator":
      return "bg-[#e7dbf7] text-[#4b2e83]";
    case "contributor":
      return "bg-[#dcedf7] text-[#1d5c8f]";
    default:
      return "bg-[#e9ebed] text-[#41484c]";
  }
}

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

    if (!cancelled) {
      void load(query, token);
    }

    return () => {
      cancelled = true;
    };
    // Reload when the search term settles.
  }, [ready, token, query, load]);

  if (!ready || !token || status === "loading") {
    return (
      <main className="min-h-screen bg-[#f3f4f5] p-4 text-[#2c3134]">
        <Navbar />
        <p role="status" className="p-6">
          Checking session...
        </p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="min-h-screen bg-[#f3f4f5] p-4 text-[#2c3134]">
        <Navbar />
        <div className="mx-auto max-w-3xl p-6">
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </p>
        </div>
      </main>
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
    <main className="min-h-screen bg-[#f3f4f5] px-4 py-6 text-[#2c3134] sm:px-6 lg:px-8">
      <Navbar />

      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Users &amp; Access
          </h1>
          <p className="text-sm text-[#687178]">
            Locate an existing account and change its role between Learner
            and Contributor. Changes take effect immediately; history and
            authored content are never touched.
          </p>
        </header>

        <form
          className="flex gap-3 rounded-md border border-[#d4d8db] bg-white p-4"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            if (token) void load(query, token);
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            placeholder="Search by email or name"
            aria-label="Search accounts by email or name"
            className="flex-1 rounded-md border border-[#cbd0d3] px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          />
          <button
            type="submit"
            className="rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a]"
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
          <p className="rounded-md border border-[#d4d8db] bg-white p-4 text-sm text-[#687178]">
            No accounts match “{query}”.
          </p>
        )}

        {page && page.items.length > 0 && (
          <ul className="space-y-3">
            {page.items.map((user) => {
              const manageable = user.role !== "administrator";
              return (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[#d4d8db] bg-white p-4"
                >
                  <div className="space-y-1">
                    <p className="font-semibold">{user.fullName}</p>
                    <p className="text-sm text-[#687178]">{user.email}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex rounded px-2.5 py-1 text-xs font-medium ${roleBadgeClasses(user.role)}`}
                    >
                      {user.role}
                    </span>
                    <span className="text-xs text-[#8a9199]">
                      {user.is_verified ? "verified" : "unverified"}
                    </span>

                    {manageable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setChangeError(null);
                          setSuccessNote(null);
                          setPendingChange({
                            user,
                            role:
                              user.role === "contributor"
                                ? "learner"
                                : "contributor",
                          });
                        }}
                        className="rounded-md border border-[#343a3e] px-3 py-1.5 text-sm font-semibold hover:cursor-pointer hover:bg-[#f0f1f2]"
                      >
                        {user.role === "contributor"
                          ? "Revoke Contributor"
                          : "Make Contributor"}
                      </button>
                    ) : (
                      <span
                        className="text-xs text-[#8a9199]"
                        title="Administrator provisioning is separately governed"
                      >
                        Administrator
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {pendingChange && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-change-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md space-y-4 rounded-md border bg-white p-6">
              <h2 id="role-change-title" className="text-lg font-bold">
                {pendingChange.role === "contributor"
                  ? "Grant Contributor access?"
                  : "Revoke Contributor access?"}
              </h2>
              <p className="text-sm text-[#687178]">
                {pendingChange.role === "contributor"
                  ? `${pendingChange.user.fullName} (${pendingChange.user.email}) will gain draft-authoring access.`
                  : `${pendingChange.user.fullName} (${pendingChange.user.email}) will lose Contributor access immediately, including in any open session. Their account, history and authored questions stay intact.`}
              </p>

              {changeError && (
                <p
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {changeError}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPendingChange(null);
                    setChangeError(null);
                  }}
                  disabled={changeInFlight}
                  className="rounded-md border border-[#cbd0d3] px-4 py-2 text-sm hover:cursor-pointer hover:bg-[#f0f1f2] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmChange()}
                  disabled={changeInFlight}
                  className="rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:cursor-pointer hover:bg-[#22262a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {changeInFlight
                    ? "Applying..."
                    : pendingChange.role === "contributor"
                      ? "Confirm: make Contributor"
                      : "Confirm: revoke Contributor"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
