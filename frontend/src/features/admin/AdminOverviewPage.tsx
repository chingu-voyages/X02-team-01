"use client";

import { useCallback, useEffect, useState } from "react";

import {
  FilePlus2,
  Users,
  BookOpenCheck,
} from "lucide-react";
import Link from "next/link";

import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  DashboardFilters,
  DashboardOverview,
  DashboardPeriod,
  getDashboardOverview,
} from "@/lib/admin-dashboard-api";

type LoadStatus = "loading" | "ready" | "error" | "forbidden";

const periodOptions: { value: DashboardPeriod; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom dates" },
];

export default function AdminOverviewPage() {
  const { token, ready, handleError } = useDemoSession();

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);

  const [period, setPeriod] = useState<DashboardPeriod>("30");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [examFilter, setExamFilter] = useState("");

  const load = useCallback(
    async (activeToken: string, filters: DashboardFilters) => {
      setStatus("loading");
      setLoadError(null);
      try {
        const data = await getDashboardOverview(activeToken, filters);
        setOverview(data);
        setStatus("ready");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setStatus("forbidden");
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load the dashboard.",
        );
        setStatus("error");
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (!ready || !token) return;

    const filters = {
      period,
      from: fromDate || undefined,
      to: toDate || undefined,
      exam_id: examFilter || undefined,
    };

    // Async body: the fetch state transitions happen after the effect
    // body returns, avoiding synchronous cascading renders.
    void (async () => {
      await load(token, filters);
    })();
  }, [ready, token, period, fromDate, toDate, examFilter, load]);

  if (!ready || !token || status === "loading") {
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Loading the dashboard...
      </p>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="rounded-md border border-brand-border bg-white p-6 shadow-xs">
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          You do not have permission to view the Administrator dashboard.
        </p>
      </div>
    );
  }

  if (status === "error" || !overview) {
    return (
      <div className="rounded-md border border-brand-border bg-white p-6 shadow-xs">
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {loadError ?? "The dashboard is unavailable."}
        </p>

        <button
          type="button"
          onClick={() => {
            if (token)
              void load(token, {
                period,
                from: fromDate || undefined,
                to: toDate || undefined,
                exam_id: examFilter || undefined,
              });
          }}
          className="mt-4 cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint"
        >
          Retry
        </button>
      </div>
    );
  }

  const periodFilterAffects =
    period !== "all" || Boolean(examFilter);

  const shortcuts = [
    {
      href: "/admin/questions/new",
      label: "Create Question",
      description: "Author a new question draft",
      icon: FilePlus2,
    },
    {
      href: "/admin/practice-exams",
      label: "Manage Exams",
      description: "Build and publish practice exams",
      icon: BookOpenCheck,
    },
    {
      href: "/admin/users",
      label: "Manage Users",
      description: "Roles and grading permissions",
      icon: Users,
    },
  ];

  const kpis = [
    {
      label: "Registered Learners",
      value: overview.registered_learners,
      note: "Current snapshot · all-time accounts (Learner + Contributor)",
    },
    {
      label: "Completed Attempts",
      value: overview.completed_attempts,
      note: periodFilterAffects
        ? "Filtered · finalized submissions"
        : "Last 30 days · finalized submissions",
    },
    {
      label: "Participating Learners",
      value: overview.participating_learners,
      note: periodFilterAffects
        ? "Filtered · unique attempt owners"
        : "Last 30 days · unique attempt owners",
    },
    {
      label: "Pending Question Reviews",
      value: overview.pending_question_reviews,
      note: "Current snapshot · submitted or in review",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl">
          Dashboard
        </h1>
        <p className="text-sm text-brand-text/70">
          Practice Engine activity at a glance. Finalized attempts are
          measured in UTC over the selected reporting period.
        </p>
      </header>

      {/* Filters (AC7): period + exam scope the completed-attempt data
          only; the two snapshot KPIs stay clearly labelled. */}
      <form
        aria-label="Dashboard filters"
        className="flex flex-wrap items-end gap-3 rounded-md border border-brand-border bg-white p-4 shadow-xs"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="text-sm font-semibold">
          Reporting period

          <select
            value={period}
            aria-label="Reporting period"
            onChange={(event) => {
              const value = event.target.value as DashboardPeriod;
              setPeriod(value);
              if (value !== "custom") {
                setFromDate("");
                setToDate("");
              }
            }}
            className="mt-1 block w-44 rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {period === "custom" && (
          <>
            <label className="text-sm font-semibold">
              From

              <input
                type="date"
                value={fromDate}
                aria-label="Period start date"
                onChange={(event) => setFromDate(event.target.value)}
                className="mt-1 block rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
            </label>

            <label className="text-sm font-semibold">
              To

              <input
                type="date"
                value={toDate}
                aria-label="Period end date"
                onChange={(event) => setToDate(event.target.value)}
                className="mt-1 block rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
            </label>
          </>
        )}

        <label className="text-sm font-semibold">
          Exam

          <select
            value={examFilter}
            aria-label="Exam filter"
            onChange={(event) => setExamFilter(event.target.value)}
            className="mt-1 block w-52 rounded-md border border-brand-border bg-brand-surface/50 px-3 py-2 text-sm font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            <option value="">All Exams</option>
            {overview.attempts_by_exam
              .filter((row) => row.exam_id)
              .map((row) => (
                <option key={row.exam_id} value={row.exam_id ?? ""}>
                  {row.title}
                </option>
              ))}
          </select>
        </label>
      </form>

      {/* Four KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-md border border-brand-border bg-white p-5 shadow-xs"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-text/60">
              {kpi.label}
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-brand-text">
              {kpi.value.toLocaleString("en-US")}
            </p>
            <p className="mt-2 text-xs leading-5 text-brand-text/55">
              {kpi.note}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Completed Attempts by Exam (AC6) */}
        <div className="rounded-md border border-brand-border bg-white p-5 shadow-xs lg:col-span-3">
          <h2 className="text-sm font-semibold text-brand-text">
            Completed attempts by exam
          </h2>

          {overview.attempts_by_exam.length === 0 ? (
            <p className="mt-3 text-sm text-brand-text/60">
              No completed attempts match the selected filters.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">
                Completed attempts grouped by exam, highest count first
              </caption>
              <thead>
                <tr className="border-b border-brand-border text-left text-xs uppercase tracking-wide text-brand-text/55">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Exam
                  </th>
                  <th
                    scope="col"
                    className="py-2 text-right font-semibold"
                  >
                    Completed
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.attempts_by_exam.map((row) => (
                  <tr
                    key={row.exam_id ?? "legacy"}
                    className="border-b border-brand-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-brand-text">
                      {row.title}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-brand-text">
                      {row.count.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-brand-text/70">
                  <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide">
                    Total
                  </td>
                  <td className="py-2 text-right text-xs font-semibold tabular-nums">
                    {overview.completed_attempts.toLocaleString("en-US")}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Requires Attention (AC5) */}
        <div className="rounded-md border border-brand-border bg-white p-5 shadow-xs lg:col-span-2">
          <h2 className="text-sm font-semibold text-brand-text">
            Requires attention
          </h2>
          <p className="mt-1 text-xs text-brand-text/55">
            Questions waiting in review · current snapshot
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-md border border-brand-border bg-brand-surface/40 px-4 py-3">
              <span className="text-sm text-brand-text">Submitted</span>
              <span className="text-lg font-bold tabular-nums text-brand-text">
                {overview.review_breakdown.submitted}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-md border border-brand-border bg-brand-surface/40 px-4 py-3">
              <span className="text-sm text-brand-text">In review</span>
              <span className="text-lg font-bold tabular-nums text-brand-text">
                {overview.review_breakdown.in_review}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-brand-border pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-text/55">
                Total
              </span>
              <span className="text-sm font-bold tabular-nums text-brand-text">
                {overview.pending_question_reviews}
              </span>
            </div>
          </div>

          <Link
            href="/admin/questions?review_status=submitted"
            className="mt-4 inline-block text-sm font-medium text-brand-text underline decoration-brand-accent underline-offset-4 hover:decoration-2"
          >
            Open the question bank
          </Link>
        </div>
      </div>

      {/* Three quick-action shortcuts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {shortcuts.map((shortcut) => (
          <Link
            key={shortcut.href}
            href={shortcut.href}
            className="group rounded-md border border-brand-border bg-white p-5 shadow-xs transition-colors hover:bg-brand-secondary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-accent"
          >
            <shortcut.icon
              aria-hidden="true"
              className="size-6 text-brand-text/70"
            />
            <p className="mt-3 text-sm font-semibold text-brand-text">
              {shortcut.label}
            </p>
            <p className="mt-1 text-xs text-brand-text/60">
              {shortcut.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
