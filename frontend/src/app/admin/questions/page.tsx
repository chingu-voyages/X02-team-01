"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ImageIcon,
  MoreHorizontal,
  Search,
} from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import {
  getAdminCategories,
  getAdminCertifications,
} from "@/lib/admin-catalog-api";
import {
  getManagedQuestions,
} from "@/lib/admin-question-api";
import { ApiError } from "@/lib/api-client";

import type {
  AdminCategory,
  AdminCertification,
} from "@/types/admin-catalog-api.types";

import type {
  AdminDifficulty,
  AdminPublicationStatus,
  AdminQuestionBankItem,
  AdminQuestionBankQuery,
  AdminQuestionType,
  AdminReviewStatus,
} from "@/types/admin-question-api.types";

type LoadStatus =
  | "loading"
  | "ready"
  | "error"
  | "forbidden";

type WorkflowFilter =
  | "all"
  | "pending"
  | "submitted"
  | "in_review"
  | "approved_draft"
  | "rejected"
  | "published"
  | "retired";

type MediaFilter =
  | "all"
  | "with_image"
  | "without_image";

const pageSize = 50;

function formatStatus(
  publicationStatus: AdminPublicationStatus,
  reviewStatus: AdminReviewStatus,
) {
  if (
    publicationStatus ===
    "retired"
  ) {
    return "Retired";
  }

  if (publicationStatus === "inactive") {
    return "Rejected";
  }

  if (
    publicationStatus ===
    "active"
  ) {
    return "Published";
  }

  if (
    reviewStatus ===
    "rejected"
  ) {
    return "Rejected";
  }

  if (reviewStatus === "submitted") {
    return "Submitted";
  }

  if (reviewStatus === "in_review") {
    return "In Review";
  }

  if (
    reviewStatus ===
    "approved"
  ) {
    return "Approved Draft";
  }

  return "Pending Review";
}

function questionTypeLabel(
  questionType: AdminQuestionType,
) {
  return questionType ===
    "multiple_choice"
    ? "MCQ"
    : "Short";
}

function difficultyLabel(
  difficulty: AdminDifficulty,
) {
  return (
    difficulty
      .charAt(0)
      .toUpperCase() +
    difficulty.slice(1)
  );
}

function shortQuestionId(
  id: string,
) {
  return `Q-${id
    .slice(0, 8)
    .toUpperCase()}`;
}

function formatDate(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(date);
}

function statusClasses(
  status: string,
) {
  if (
    status ===
    "Published"
  ) {
    return (
      "bg-brand-accent-tint " +
      "text-brand-text"
    );
  }

  if (
    status ===
      "Retired" ||
    status ===
      "Rejected"
  ) {
    return (
      "bg-brand-secondary/50 " +
      "text-brand-text"
    );
  }

  return (
    "bg-brand-surface " +
    "text-brand-text"
  );
}

function workflowQuery(
  workflow: WorkflowFilter,
): Pick<
  AdminQuestionBankQuery,
  | "review_status"
  | "publication_status"
> {
  if (workflow === "submitted" || workflow === "in_review") {
    return { review_status: workflow };
  }

  if (
    workflow ===
    "pending"
  ) {
    return {
      review_status:
        "pending",
    };
  }

  if (
    workflow ===
    "approved_draft"
  ) {
    return {
      review_status:
        "approved",
      publication_status:
        "draft",
    };
  }

  if (
    workflow ===
    "rejected"
  ) {
    return {
      review_status:
        "rejected",
    };
  }

  if (
    workflow ===
    "published"
  ) {
    return {
      publication_status:
        "active",
    };
  }

  if (
    workflow ===
    "retired"
  ) {
    return {
      publication_status:
        "retired",
    };
  }

  return {};
}

export default function AdminQuestionsPage() {
  const {
    token,
    ready,
    handleError,
  } =
    useDemoSession();

  const [
    questions,
    setQuestions,
  ] = useState<
    AdminQuestionBankItem[]
  >([]);

  const [
    certifications,
    setCertifications,
  ] = useState<
    AdminCertification[]
  >([]);

  const [
    categories,
    setCategories,
  ] = useState<
    AdminCategory[]
  >([]);

  const [
    loadStatus,
    setLoadStatus,
  ] =
    useState<LoadStatus>(
      "loading",
    );

  const [
    loadError,
    setLoadError,
  ] = useState("");

  const [
    reloadKey,
    setReloadKey,
  ] = useState(0);

  const [
    searchInput,
    setSearchInput,
  ] = useState("");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    certificationFilter,
    setCertificationFilter,
  ] = useState("all");

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("all");

  const [
    questionType,
    setQuestionType,
  ] = useState("all");

  const [
    difficulty,
    setDifficulty,
  ] = useState("all");

  const [
    workflow,
    setWorkflow,
  ] =
    useState<WorkflowFilter>(
      "all",
    );

  const [
    mediaFilter,
    setMediaFilter,
  ] =
    useState<MediaFilter>(
      "all",
    );

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    totalCount,
    setTotalCount,
  ] = useState(0);

  useEffect(() => {
    const timeout =
      window.setTimeout(
        () => {
          setSearch(
            searchInput.trim(),
          );
          setPage(1);
        },
        300,
      );

    return () => {
      window.clearTimeout(
        timeout,
      );
    };
  }, [searchInput]);

  useEffect(() => {
    if (
      !ready ||
      !token
    ) {
      return;
    }

    let cancelled = false;

    Promise.all([
      getAdminCertifications(
        token,
      ),
      getAdminCategories(
        token,
      ),
    ])
      .then(
        ([
          certificationItems,
          categoryItems,
        ]) => {
          if (cancelled) {
            return;
          }

          setCertifications(
            certificationItems,
          );
          setCategories(
            categoryItems,
          );
        },
      )
      .catch(
        (
          error: unknown,
        ) => {
          if (cancelled) {
            return;
          }

          if (
            error instanceof
              ApiError &&
            error.status ===
              401
          ) {
            handleError(
              error,
            );
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    token,
    handleError,
  ]);

  useEffect(() => {
    if (
      !ready ||
      !token
    ) {
      return;
    }

    let cancelled = false;

    const query: AdminQuestionBankQuery =
      {
        page,
        page_size:
          pageSize,
        ...workflowQuery(
          workflow,
        ),
      };

    if (search) {
      query.search =
        search;
    }

    if (
      certificationFilter !==
      "all"
    ) {
      query.certification_id =
        certificationFilter;
    }

    if (
      categoryFilter !==
      "all"
    ) {
      query.category_id =
        categoryFilter;
    }

    if (
      questionType !==
      "all"
    ) {
      query.question_type =
        questionType as AdminQuestionType;
    }

    if (
      difficulty !==
      "all"
    ) {
      query.difficulty =
        difficulty as AdminDifficulty;
    }

    if (
      mediaFilter ===
      "with_image"
    ) {
      query.has_image =
        true;
    }

    if (
      mediaFilter ===
      "without_image"
    ) {
      query.has_image =
        false;
    }

    getManagedQuestions(
      token,
      query,
    )
      .then(
        (response) => {
          if (cancelled) {
            return;
          }

          const pageCount =
            Math.max(
              1,
              Math.ceil(
                response.count /
                  pageSize,
              ),
            );

          if (
            page >
            pageCount
          ) {
            setPage(
              pageCount,
            );
            return;
          }

          setQuestions(
            response.items,
          );
          setTotalCount(
            response.count,
          );
          setLoadError("");
          setLoadStatus(
            "ready",
          );
        },
      )
      .catch(
        (
          error: unknown,
        ) => {
          if (cancelled) {
            return;
          }

          if (
            error instanceof
              ApiError &&
            error.status ===
              401
          ) {
            handleError(
              error,
            );
            return;
          }

          if (
            error instanceof
              ApiError &&
            error.status ===
              403
          ) {
            setLoadStatus(
              "forbidden",
            );
            return;
          }

          setLoadError(
            error instanceof
              Error
              ? error.message
              : "Unable to load questions.",
          );
          setLoadStatus(
            "error",
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    token,
    reloadKey,
    handleError,
    search,
    certificationFilter,
    categoryFilter,
    questionType,
    difficulty,
    workflow,
    mediaFilter,
    page,
  ]);

  const visibleCategories =
    useMemo(
      () =>
        categories
          .filter(
            (category) =>
              certificationFilter ===
                "all" ||
              category.certification_id ===
                certificationFilter,
          )
          .sort(
            (
              left,
              right,
            ) =>
              left.name.localeCompare(
                right.name,
              ),
          ),
      [
        categories,
        certificationFilter,
      ],
    );

  const pageCount =
    Math.max(
      1,
      Math.ceil(
        totalCount /
          pageSize,
      ),
    );

  const startItem =
    totalCount === 0
      ? 0
      : (page - 1) *
          pageSize +
        1;

  const endItem =
    Math.min(
      page * pageSize,
      totalCount,
    );

  function retryLoading() {
    setLoadError("");
    setLoadStatus(
      "loading",
    );
    setReloadKey(
      (value) =>
        value + 1,
    );
  }

  function updateCertification(
    value: string,
  ) {
    setCertificationFilter(
      value,
    );
    setCategoryFilter(
      "all",
    );
    setPage(1);
  }

  function updateCategory(
    value: string,
  ) {
    setCategoryFilter(
      value,
    );
    setPage(1);
  }

  function updateQuestionType(
    value: string,
  ) {
    setQuestionType(
      value,
    );
    setPage(1);
  }

  function updateDifficulty(
    value: string,
  ) {
    setDifficulty(
      value,
    );
    setPage(1);
  }

  function updateWorkflow(
    value: string,
  ) {
    setWorkflow(
      value as WorkflowFilter,
    );
    setPage(1);
  }

  function updateMedia(
    value: string,
  ) {
    setMediaFilter(
      value as MediaFilter,
    );
    setPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setCertificationFilter(
      "all",
    );
    setCategoryFilter(
      "all",
    );
    setQuestionType(
      "all",
    );
    setDifficulty(
      "all",
    );
    setWorkflow(
      "all",
    );
    setMediaFilter(
      "all",
    );
    setPage(1);
  }

  if (
    !ready ||
    !token
  ) {
    return (
      <p role="status">
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
          subtitle="Search, filter and manage practice questions across the bank."
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/admin/questions/import"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand-border bg-white px-5 text-sm font-semibold text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Import Questions
          </Link>

          <Link
            href="/admin/questions/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-accent px-6 text-sm font-semibold text-brand-text hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            + Create Question
          </Link>
        </div>
      </div>

      {loadStatus ===
        "forbidden" && (
        <div
          role="alert"
          className="rounded-md border border-brand-border bg-brand-surface p-6"
        >
          <h2 className="font-semibold">
            Access denied
          </h2>
          <p className="mt-2 text-sm text-brand-text/70">
            Your account does not
            have permission to
            manage the question
            bank.
          </p>
        </div>
      )}

      {loadStatus ===
        "error" && (
        <div
          role="alert"
          className="rounded-md border border-brand-border bg-white p-6"
        >
          <p className="text-sm text-red-700">
            {loadError}
          </p>
          <button
            type="button"
            onClick={
              retryLoading
            }
            className="mt-4 rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-brand-text"
          >
            Retry
          </button>
        </div>
      )}

      {loadStatus ===
        "loading" && (
        <div
          role="status"
          className="rounded-md border border-brand-border bg-white p-8 text-sm text-brand-text/70"
        >
          Loading question
          bank...
        </div>
      )}

      {loadStatus ===
        "ready" && (
        <>
          <div className="mb-4 rounded-md border border-brand-border bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-4">
              <label className="relative lg:col-span-2">
                <span className="sr-only">
                  Search questions
                </span>
                <Search
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-text/60"
                />
                <input
                  type="search"
                  value={
                    searchInput
                  }
                  onChange={(
                    event,
                  ) =>
                    setSearchInput(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder="Search question text, certification, category or full ID"
                  className="h-11 w-full rounded-md border border-brand-border bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-accent"
                />
              </label>

              <select
                aria-label="Certification"
                value={
                  certificationFilter
                }
                onChange={(
                  event,
                ) =>
                  updateCertification(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Certifications
                </option>
                {certifications.map(
                  (
                    certification,
                  ) => (
                    <option
                      key={
                        certification.id
                      }
                      value={
                        certification.id
                      }
                    >
                      {
                        certification.name
                      }
                    </option>
                  ),
                )}
              </select>

              <select
                aria-label="Category"
                value={
                  categoryFilter
                }
                onChange={(
                  event,
                ) =>
                  updateCategory(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Categories
                </option>
                {visibleCategories.map(
                  (
                    category,
                  ) => (
                    <option
                      key={
                        category.id
                      }
                      value={
                        category.id
                      }
                    >
                      {
                        category.name
                      }
                    </option>
                  ),
                )}
              </select>

              <select
                aria-label="Question type"
                value={
                  questionType
                }
                onChange={(
                  event,
                ) =>
                  updateQuestionType(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Types
                </option>
                <option value="multiple_choice">
                  Multiple Choice
                </option>
                <option value="short_answer">
                  Short Answer
                </option>
              </select>

              <select
                aria-label="Difficulty"
                value={
                  difficulty
                }
                onChange={(
                  event,
                ) =>
                  updateDifficulty(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Difficulties
                </option>
                <option value="easy">
                  Easy
                </option>
                <option value="medium">
                  Medium
                </option>
                <option value="hard">
                  Hard
                </option>
              </select>

              <select
                aria-label="Workflow status"
                value={
                  workflow
                }
                onChange={(
                  event,
                ) =>
                  updateWorkflow(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Workflow States
                </option>
                <option value="pending">
                  Pending Review
                </option>
                <option value="submitted">
                  Submitted
                </option>
                <option value="in_review">
                  In Review
                </option>
                <option value="approved_draft">
                  Approved Draft
                </option>
                <option value="rejected">
                  Rejected
                </option>
                <option value="published">
                  Published
                </option>
                <option value="retired">
                  Retired
                </option>
              </select>

              <select
                aria-label="Media"
                value={
                  mediaFilter
                }
                onChange={(
                  event,
                ) =>
                  updateMedia(
                    event
                      .target
                      .value,
                  )
                }
                className="h-11 rounded-md border border-brand-border bg-white px-3 text-sm"
              >
                <option value="all">
                  All Media
                </option>
                <option value="with_image">
                  With Image
                </option>
                <option value="without_image">
                  Without Image
                </option>
              </select>
            </div>

            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-xs text-brand-text/60">
                Filters run on the
                server so the bank
                stays fast as it
                grows.
              </p>

              <button
                type="button"
                onClick={
                  clearFilters
                }
                className="text-sm font-medium text-brand-text/80 underline-offset-4 hover:underline"
              >
                Clear filters
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-brand-border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead className="bg-brand-surface text-xs font-semibold uppercase tracking-wide text-brand-text/70">
                  <tr>
                    <th className="px-3 py-4">
                      ID
                    </th>
                    <th className="px-3 py-4">
                      Question Preview
                    </th>
                    <th className="px-3 py-4">
                      Certification
                    </th>
                    <th className="px-3 py-4">
                      Category
                    </th>
                    <th className="px-3 py-4">
                      Type
                    </th>
                    <th className="px-3 py-4">
                      Difficulty
                    </th>
                    <th className="px-3 py-4">
                      Status
                    </th>
                    <th className="px-3 py-4">
                      Media
                    </th>
                    <th className="px-3 py-4">
                      Updated
                    </th>
                    <th className="px-3 py-4 text-center">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {questions.map(
                    (
                      question,
                    ) => {
                      const displayStatus =
                        formatStatus(
                          question.publication_status,
                          question.review_status,
                        );

                      return (
                        <tr
                          key={
                            question.question_id
                          }
                          className="border-t border-brand-border"
                        >
                          <td
                            className="whitespace-nowrap px-3 py-4 font-medium"
                            title={
                              question.question_id
                            }
                          >
                            {shortQuestionId(
                              question.question_id,
                            )}
                          </td>

                          <td className="max-w-[300px] px-3 py-4">
                            <span className="block truncate">
                              {
                                question.question_preview
                              }
                            </span>
                          </td>

                          <td className="max-w-[180px] px-3 py-4">
                            {
                              question.certification_name
                            }
                          </td>

                          <td className="max-w-[180px] px-3 py-4">
                            {question.category_name ??
                              "Uncategorized"}
                          </td>

                          <td className="whitespace-nowrap px-3 py-4">
                            {questionTypeLabel(
                              question.question_type,
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-4">
                            {difficultyLabel(
                              question.difficulty,
                            )}
                          </td>

                          <td className="px-3 py-4">
                            <span
                              className={`inline-flex min-w-24 justify-center rounded-full px-3 py-1.5 text-xs font-medium ${statusClasses(
                                displayStatus,
                              )}`}
                            >
                              {
                                displayStatus
                              }
                            </span>
                          </td>

                          <td className="px-3 py-4 text-brand-text/70">
                            {question.has_image ? (
                              <span className="inline-flex items-center gap-1.5">
                                <ImageIcon
                                  aria-hidden="true"
                                  className="size-4"
                                />
                                Image
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-4">
                            {formatDate(
                              question.last_updated,
                            )}
                          </td>

                          <td className="px-3 py-4 text-center">
                            <Link
                              href={`/admin/questions/${encodeURIComponent(
                                question.question_id,
                              )}`}
                              aria-label={`View ${shortQuestionId(
                                question.question_id,
                              )}`}
                              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-brand-surface"
                            >
                              <MoreHorizontal
                                aria-hidden="true"
                                className="size-5"
                              />
                            </Link>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            {questions.length ===
              0 && (
              <div className="border-t border-brand-border p-10 text-center text-sm text-brand-text/70">
                No questions match
                the current
                filters.
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-3 text-sm text-brand-text/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing{" "}
              {startItem}–
              {endItem} of{" "}
              {totalCount}{" "}
              questions
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() =>
                  setPage(
                    (
                      value,
                    ) =>
                      Math.max(
                        1,
                        value -
                          1,
                      ),
                  )
                }
                disabled={
                  page === 1
                }
                className="rounded px-2 py-1 disabled:opacity-40"
              >
                ‹
              </button>

              <span className="min-w-16 text-center">
                {page} /{" "}
                {pageCount}
              </span>

              <button
                type="button"
                aria-label="Next page"
                onClick={() =>
                  setPage(
                    (
                      value,
                    ) =>
                      Math.min(
                        pageCount,
                        value +
                          1,
                      ),
                  )
                }
                disabled={
                  page ===
                  pageCount
                }
                className="rounded px-2 py-1 disabled:opacity-40"
              >
                ›
              </button>

              <span className="ml-2">
                {pageSize} /
                page
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
