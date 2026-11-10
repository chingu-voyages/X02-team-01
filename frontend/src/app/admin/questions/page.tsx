"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getManagedQuestions } from "@/lib/admin-question-api";

import type {
  AdminPublicationStatus,
  AdminQuestionBankItem,
  AdminQuestionType,
  AdminReviewStatus,
} from "@/types/admin-question-api.types";

type LoadStatus = "loading" | "ready" | "error" | "forbidden";

const pageSize = 10;

function formatStatus(
  publicationStatus: AdminPublicationStatus,
  reviewStatus: AdminReviewStatus,
) {
  if (publicationStatus === "retired") return "Retired";
  if (publicationStatus === "active") return "Published";
  if (reviewStatus === "rejected") return "Rejected";
  return "Draft";
}

function questionTypeLabel(questionType: AdminQuestionType) {
  return questionType === "multiple_choice" ? "MCQ" : "Short";
}

function shortQuestionId(id: string) {
  return `Q-${id.slice(0, 8).toUpperCase()}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusClasses(status: string) {
  if (status === "Published") return "bg-[#dfe2e4] text-[#303438]";
  if (status === "Retired") return "bg-[#d9dde0] text-[#303438]";
  if (status === "Rejected") return "bg-[#e3e5e7] text-[#303438]";
  return "bg-[#e5e7e9] text-[#303438]";
}

export default function AdminQuestionsPage() {
  const { token, ready, handleError } = useDemoSession();
  const [questions, setQuestions] = useState<AdminQuestionBankItem[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [questionType, setQuestionType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;

    getManagedQuestions(token)
      .then((response) => {
        if (cancelled) return;
        setQuestions(response.items);
        setLoadError("");
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }

        if (error instanceof ApiError && error.status === 403) {
          setLoadStatus("forbidden");
          return;
        }

        setLoadError(
          error instanceof Error ? error.message : "Unable to load questions.",
        );
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, reloadKey, handleError]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          questions
            .map((question) => question.category_name)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [questions],
  );

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return questions.filter((question) => {
      const displayStatus = formatStatus(
        question.publication_status,
        question.review_status,
      );
      const matchesSearch =
        !normalizedSearch ||
        question.question_preview.toLowerCase().includes(normalizedSearch) ||
        question.question_id.toLowerCase().includes(normalizedSearch) ||
        shortQuestionId(question.question_id)
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesType =
        questionType === "all" || question.question_type === questionType;
      const matchesStatus =
        statusFilter === "all" || displayStatus === statusFilter;
      const matchesCategory =
        categoryFilter === "all" || question.category_name === categoryFilter;

      return matchesSearch && matchesType && matchesStatus && matchesCategory;
    });
  }, [questions, search, questionType, statusFilter, categoryFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredQuestions.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filteredQuestions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function retryLoading() {
    setLoadError("");
    setLoadStatus("loading");
    setReloadKey((value) => value + 1);
  }

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updateQuestionType(value: string) {
    setQuestionType(value);
    setPage(1);
  }

  function updateStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function updateCategoryFilter(value: string) {
    setCategoryFilter(value);
    setPage(1);
  }

  if (!ready || !token) {
    return <p role="status">Checking session...</p>;
  }

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          stepLabel="JHEP-23 / Question Bank"
          title="Question Bank"
          subtitle="Manage practice questions, drafts and inactive records."
        />

        <Link
          href="/admin/questions/new"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white hover:bg-[#292d30] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          + Create Question
        </Link>
      </div>

      {loadStatus === "forbidden" && (
        <div role="alert" className="rounded-md border border-[#cfd2d5] bg-[#f3f4f5] p-6">
          <h2 className="font-semibold">Access denied</h2>
          <p className="mt-2 text-sm text-[#636a70]">
            Your account does not have permission to manage the question bank.
          </p>
        </div>
      )}

      {loadStatus === "error" && (
        <div role="alert" className="rounded-md border border-[#cfd2d5] bg-white p-6">
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={retryLoading}
            className="mt-4 rounded-md bg-[#3d4145] px-4 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>
        </div>
      )}

      {loadStatus === "loading" && (
        <div role="status" className="rounded-md border border-[#d8dbde] bg-white p-8 text-sm text-[#656c72]">
          Loading question bank...
        </div>
      )}

      {loadStatus === "ready" && (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1.6fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)_minmax(160px,0.9fr)]">
            <label className="relative">
              <span className="sr-only">Search questions</span>
              <Search aria-hidden="true" className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#737a80]" />
              <input
                type="search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="Search by question or ID"
                className="h-11 w-full rounded-md border border-[#cfd2d5] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#777e83]"
              />
            </label>

            <select
              aria-label="Question type"
              value={questionType}
              onChange={(event) => updateQuestionType(event.target.value)}
              className="h-11 rounded-md border border-[#cfd2d5] bg-white px-3 text-sm"
            >
              <option value="all">Question Type</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="short_answer">Short Answer</option>
            </select>

            <select
              aria-label="Status"
              value={statusFilter}
              onChange={(event) => updateStatusFilter(event.target.value)}
              className="h-11 rounded-md border border-[#cfd2d5] bg-white px-3 text-sm"
            >
              <option value="all">Status</option>
              <option value="Published">Published</option>
              <option value="Draft">Draft</option>
              <option value="Rejected">Rejected</option>
              <option value="Retired">Retired</option>
            </select>

            <select
              aria-label="Category"
              value={categoryFilter}
              onChange={(event) => updateCategoryFilter(event.target.value)}
              className="h-11 rounded-md border border-[#cfd2d5] bg-white px-3 text-sm"
            >
              <option value="all">Category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-md border border-[#cfd2d5] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="bg-[#f1f1f1] text-xs font-semibold uppercase tracking-wide text-[#62686d]">
                  <tr>
                    <th className="px-3 py-4">ID</th>
                    <th className="px-3 py-4">Question Preview</th>
                    <th className="px-3 py-4">Type</th>
                    <th className="px-3 py-4">Category</th>
                    <th className="px-3 py-4">Status</th>
                    <th className="px-3 py-4">Media</th>
                    <th className="px-3 py-4">Updated</th>
                    <th className="px-3 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((question) => {
                    const displayStatus = formatStatus(
                      question.publication_status,
                      question.review_status,
                    );

                    return (
                      <tr key={question.question_id} className="border-t border-[#dfe1e3]">
                        <td className="whitespace-nowrap px-3 py-4 font-medium" title={question.question_id}>
                          {shortQuestionId(question.question_id)}
                        </td>
                        <td className="max-w-[300px] px-3 py-4">
                          <span className="block truncate">{question.question_preview}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4">
                          {questionTypeLabel(question.question_type)}
                        </td>
                        <td className="px-3 py-4">{question.category_name ?? "Uncategorized"}</td>
                        <td className="px-3 py-4">
                          <span className={`inline-flex min-w-20 justify-center rounded-full px-3 py-1.5 text-xs font-medium ${statusClasses(displayStatus)}`}>
                            {displayStatus}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-[#6d7378]">—</td>
                        <td className="whitespace-nowrap px-3 py-4">
                          {formatDate(question.last_updated)}
                        </td>
                        <td className="px-3 py-4 text-center">
                          <Link
                            href={`/admin/questions/${encodeURIComponent(question.question_id)}`}
                            aria-label={`View ${shortQuestionId(question.question_id)}`}
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-[#eceeef]"
                          >
                            <MoreHorizontal aria-hidden="true" className="size-5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredQuestions.length === 0 && (
              <div className="border-t border-[#dfe1e3] p-10 text-center text-sm text-[#6b7277]">
                No questions match the current filters.
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-3 text-sm text-[#4e555a] sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {filteredQuestions.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredQuestions.length)} of {filteredQuestions.length} questions
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage === 1}
                className="rounded px-2 py-1 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="min-w-16 text-center">
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                disabled={currentPage === pageCount}
                className="rounded px-2 py-1 disabled:opacity-40"
              >
                ›
              </button>
              <span className="ml-2">10 / page</span>
            </div>
          </div>

          <p className="mt-6 text-xs text-[#777e83]">
            Media references are preserved by the backend. Uploading new media is handled in a separate story.
          </p>
        </>
      )}
    </section>
  );
}
