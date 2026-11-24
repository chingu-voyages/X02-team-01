"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getManagedQuestions } from "@/lib/admin-question-api";
import QuestionBankFilters from "./QuestionBankFilters";
import QuestionBankTable, {
  formatQuestionStatus,
  shortQuestionId,
} from "./QuestionBankTable";

import type { AdminQuestionBankItem } from "@/types/admin-question-api.types";

type LoadStatus = "loading" | "ready" | "error" | "forbidden";

const pageSize = 10;

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
      const displayStatus = formatQuestionStatus(
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
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Checking session...
      </p>
    );
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
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-accent px-6 text-sm font-semibold text-brand-text shadow-xs transition-colors hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          + Create Question
        </Link>
      </div>

      {loadStatus === "forbidden" && (
        <div
          role="alert"
          className="rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-xs"
        >
          <h2 className="font-semibold">Access denied</h2>
          <p className="mt-2 text-sm text-brand-text/70">
            Your account does not have permission to manage the question bank.
          </p>
        </div>
      )}

      {loadStatus === "error" && (
        <div
          role="alert"
          className="rounded-md border border-brand-border bg-white p-6 shadow-xs"
        >
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={retryLoading}
            className="mt-4 cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint"
          >
            Retry
          </button>
        </div>
      )}

      {loadStatus === "loading" && (
        <div
          role="status"
          className="rounded-md border border-brand-border bg-white p-8 text-sm text-brand-text/70 shadow-xs"
        >
          Loading question bank...
        </div>
      )}

      {loadStatus === "ready" && (
        <>
          <QuestionBankFilters
            search={search}
            questionType={questionType}
            statusFilter={statusFilter}
            categoryFilter={categoryFilter}
            categories={categories}
            onSearchChange={updateSearch}
            onQuestionTypeChange={updateQuestionType}
            onStatusFilterChange={updateStatusFilter}
            onCategoryFilterChange={updateCategoryFilter}
          />

          <QuestionBankTable
            items={pageItems}
            totalCount={filteredQuestions.length}
            currentPage={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />

          <p className="mt-6 text-xs text-brand-text/60">
            Media references are preserved by the backend. Uploading new media
            is handled in a separate story.
          </p>
        </>
      )}
    </section>
  );
}