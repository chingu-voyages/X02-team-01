"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getGradingPermissions,
  getPendingManualResponses,
} from "@/lib/manual-grading-api";

import type {
  GradingPermissions,
  ManualGradeQueueResponse,
  ManualResponseType,
} from "@/types/exam-api.types";

type Filter = "all" | ManualResponseType;
type LoadStatus = "loading" | "ready" | "error";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "short_answer", label: "Short answers" },
  { value: "essay", label: "Essays" },
];

export default function ManualGradingQueue() {
  const { token, role, ready, handleError } = useDemoSession();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [permissions, setPermissions] = useState<GradingPermissions>({
    short_answer: false,
    essay: false,
  });
  const [queue, setQueue] = useState<ManualGradeQueueResponse>({
    items: [],
    count: 0,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  const canReview = role === "administrator" || role === "contributor";

  const load = useCallback(
    async (activeToken: string, activeFilter: Filter) => {
      setStatus("loading");
      setError(null);
      try {
        const [ownPermissions, pending] = await Promise.all([
          getGradingPermissions(activeToken),
          getPendingManualResponses(
            activeToken,
            activeFilter === "all" ? undefined : activeFilter,
          ),
        ]);
        setPermissions(ownPermissions);
        setQueue(pending);
        setStatus("ready");
      } catch (loadError: unknown) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleError(loadError);
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load the grading queue.",
        );
        setStatus("error");
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (!ready || !token || !canReview) return;
    void Promise.resolve().then(() => load(token, filter));
  }, [ready, token, canReview, filter, load]);

  if (!ready) {
    return <p role="status">Checking session...</p>;
  }

  if (!canReview) {
    return (
      <p role="alert">
        Only administrators and contributors can review written responses.
      </p>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl">
          Manual Grading
        </h1>
        <p className="text-sm text-brand-text/70">
          Review submitted written responses. Scores are final once recorded;
          revisions stay in the grading history.
        </p>
      </header>

      <div
        role="group"
        aria-label="Filter responses by type"
        className="flex flex-wrap gap-2"
      >
        {filters.map((option) => {
          const disabled =
            option.value === "short_answer"
              ? !permissions.short_answer
              : option.value === "essay"
                ? !permissions.essay
                : false;

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="cursor-pointer rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-text transition-colors hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:bg-brand-accent"
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {status === "loading" && (
        <p role="status" className="text-sm text-brand-text/70">
          Loading responses...
        </p>
      )}

      {status === "error" && (
        <div className="space-y-3 rounded-md border border-brand-border bg-white p-5">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              if (token) void load(token, filter);
            }}
            className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text"
          >
            Retry
          </button>
        </div>
      )}

      {status === "ready" && queue.items.length === 0 && (
        <p className="rounded-md border border-brand-border bg-white p-5 text-sm text-brand-text/70">
          No written responses are waiting for review.
        </p>
      )}

      {status === "ready" && queue.items.length > 0 && (
        <ul className="space-y-3">
          {queue.items.map((item) => (
            <li
              key={`${item.attempt_id}:${item.question_version_id}`}
              className="rounded-md border border-brand-border bg-white p-5 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-text/60">
                    {item.response_type === "essay" ? "Essay" : "Short answer"}
                  </p>
                  <p className="mt-1 text-sm font-medium text-brand-text">
                    {item.learner_name ?? item.learner_email ?? "Learner"}
                  </p>
                </div>
                <p className="text-sm text-brand-text/70">
                  {item.max_points} points
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-brand-text/80">
                {item.question_preview}
              </p>
              <Link
                href={`/admin/manual-grading/${item.attempt_id}/${item.question_version_id}`}
                className="mt-4 inline-flex rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                Review response
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
