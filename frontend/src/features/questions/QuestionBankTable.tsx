"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import type {
  AdminPublicationStatus,
  AdminQuestionBankItem,
  AdminQuestionType,
  AdminReviewStatus,
} from "@/types/admin-question-api.types";

export type DisplayQuestionStatus =
  | "Published"
  | "Draft"
  | "Rejected"
  | "Retired";

export function formatQuestionStatus(
  publicationStatus: AdminPublicationStatus,
  reviewStatus: AdminReviewStatus,
): DisplayQuestionStatus {
  if (publicationStatus === "retired") return "Retired";
  if (publicationStatus === "active") return "Published";
  if (reviewStatus === "rejected") return "Rejected";
  return "Draft";
}

export function shortQuestionId(id: string): string {
  return `Q-${id.slice(0, 8).toUpperCase()}`;
}

function questionTypeLabel(questionType: AdminQuestionType): string {
  return questionType === "multiple_choice" ? "MCQ" : "Short";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusClasses(status: DisplayQuestionStatus): string {
  switch (status) {
    case "Published":
      return "bg-brand-accent-tint text-brand-text";
    case "Rejected":
      return "border border-red-200 bg-red-50 text-red-700";
    case "Retired":
      return "bg-brand-secondary/50 text-brand-text/70";
    default:
      return "border border-brand-border bg-brand-surface text-brand-text/80";
  }
}

type QuestionBankTableProps = {
  items: AdminQuestionBankItem[];
  totalCount: number;
  currentPage: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
};

export default function QuestionBankTable({
  items,
  totalCount,
  currentPage,
  pageCount,
  pageSize,
  onPageChange,
}: QuestionBankTableProps) {
  const rangeStart = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, totalCount);

  return (
    <>
      <div className="overflow-hidden rounded-md border border-brand-border bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-215 border-collapse text-left text-sm text-brand-text">
            <thead className="bg-brand-surface text-xs font-semibold uppercase tracking-wide text-brand-text/70">
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
              {items.map((question) => {
                const displayStatus = formatQuestionStatus(
                  question.publication_status,
                  question.review_status,
                );
                const shortId = shortQuestionId(question.question_id);

                return (
                  <tr
                    key={question.question_id}
                    className="border-t border-brand-border transition-colors hover:bg-brand-surface/50"
                  >
                    <td
                      className="whitespace-nowrap px-3 py-4 font-medium text-brand-text"
                      title={question.question_id}
                    >
                      {shortId}
                    </td>
                    <td className="max-w-75 px-3 py-4">
                      <span className="block truncate">
                        {question.question_preview}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {questionTypeLabel(question.question_type)}
                    </td>
                    <td className="px-3 py-4 text-brand-text/85">
                      {question.category_name ?? "Uncategorized"}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex min-w-20 justify-center rounded-full px-3 py-1 text-xs font-semibold ${statusClasses(displayStatus)}`}
                      >
                        {displayStatus}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-brand-text/60">—</td>
                    <td className="whitespace-nowrap px-3 py-4 text-brand-text/80">
                      {formatDate(question.last_updated)}
                    </td>
                    <td className="px-3 py-4 text-center">
                      <Link
                        href={`/admin/questions/${encodeURIComponent(question.question_id)}`}
                        aria-label={`View ${shortId}`}
                        className="inline-flex size-8 items-center justify-center rounded-md text-brand-text transition-colors hover:bg-brand-secondary/30"
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

        {totalCount === 0 && (
          <div className="border-t border-brand-border p-10 text-center text-sm text-brand-text/65">
            No questions match the current filters.
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 text-sm text-brand-text/80 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {rangeStart}–{rangeEnd} of {totalCount} questions
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-2.5 py-1 text-brand-text transition-colors hover:bg-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹
          </button>
          <span className="min-w-16 text-center font-medium">
            {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
            disabled={currentPage === pageCount}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-2.5 py-1 text-brand-text transition-colors hover:bg-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
          <span className="ml-2 text-brand-text/65">{pageSize} / page</span>
        </div>
      </div>
    </>
  );
}