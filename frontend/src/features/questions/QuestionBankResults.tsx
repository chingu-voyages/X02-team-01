"use client";

import Link from "next/link";
import { Eye, ImageIcon, Pencil } from "lucide-react";
import type { AdminQuestionBankItem } from "@/types/admin-question-api.types";

export function questionBankStatus(question: Pick<AdminQuestionBankItem, "publication_status" | "review_status">): string {
  if (question.publication_status === "retired") return "Retired";
  if (question.review_status === "rejected") return "Rejected";
  if (question.publication_status === "inactive") return "Inactive";
  if (question.publication_status === "active") return "Published";
  if (question.review_status === "submitted") return "Submitted";
  if (question.review_status === "in_review") return "In Review";
  if (question.review_status === "approved") return "Approved Draft";
  return "Draft";
}

// Match the detail page's current lifecycle and ownership affordances.
// These checks control presentation, never API authorization.
export function canEditBankQuestion(question: Pick<AdminQuestionBankItem, "publication_status" | "review_status" | "created_by_id">, role: string | null | undefined, userId: string | null): boolean {
  if (question.review_status === "rejected" || question.publication_status === "inactive" || question.publication_status === "retired") return false;
  if (question.publication_status === "active") return role === "administrator";
  return question.publication_status === "draft" && question.review_status === "pending" &&
    (role === "administrator" || (role === "contributor" && Boolean(userId) && question.created_by_id === userId));
}

function statusClasses(status: string) {
  switch (status) {
    case "Published": return "border-green-200 bg-green-50 text-green-800";
    case "Submitted": case "In Review": return "border-amber-200 bg-amber-50 text-amber-900";
    case "Rejected": return "border-red-200 bg-red-50 text-red-800";
    default: return "border-brand-border bg-brand-surface text-brand-text";
  }
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

const cell = "block min-w-0 wrap-anywhere px-1 py-1.5 @min-[900px]/bank:table-cell @min-[900px]/bank:px-3 @min-[900px]/bank:py-4";
const mobileLabel = "mb-1 block text-xs font-semibold text-brand-text/65 @min-[900px]/bank:hidden";
const actionLink = "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2";
const pageButton = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-brand-border bg-white px-3 py-2 font-semibold hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

type Props = {
  items: AdminQuestionBankItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  role: string | null | undefined;
  userId: string | null;
  hasFilters: boolean;
  onClearFilters: () => void;
};

export default function QuestionBankResults({ items, totalCount, page, pageSize, onPageChange, role, userId, hasFilters, onClearFilters }: Props) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-xs leading-5 text-brand-text/70">{role === "administrator" ? "Open a question for review and publication actions. Edit is available for permitted drafts and published revisions." : "Open a question for full details and review status. Edit is available for your permitted drafts."}</p>
      <div className="min-w-0 rounded-md border border-brand-border bg-white shadow-xs">
        <table role="table" aria-label="Question Bank results" className="block w-full min-w-0 border-collapse text-left text-sm text-brand-text @min-[900px]/bank:table @min-[900px]/bank:table-fixed">
          <thead role="rowgroup" className="sr-only bg-brand-surface text-xs font-semibold uppercase tracking-wide text-brand-text/70 @min-[900px]/bank:not-sr-only @min-[900px]/bank:table-header-group">
            <tr role="row">
              <th role="columnheader" scope="col" className="w-[28%] px-3 py-3">Question</th>
              <th role="columnheader" scope="col" className="w-[23%] px-3 py-3">Certification / Category</th>
              <th role="columnheader" scope="col" className="w-[12%] px-3 py-3">Type / Difficulty</th>
              <th role="columnheader" scope="col" className="w-[13%] px-3 py-3">Status</th>
              <th role="columnheader" scope="col" className="w-[12%] px-3 py-3">Media / Updated</th>
              <th role="columnheader" scope="col" className="w-[12%] px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block min-w-0 @min-[900px]/bank:table-row-group">
            {items.map((question) => {
              const shortId = `Q-${question.question_id.slice(0, 8).toUpperCase()}`;
              const href = `/admin/questions/${encodeURIComponent(question.question_id)}`;
              const status = questionBankStatus(question);
              const canEdit = canEditBankQuestion(question, role, userId);
              return <tr key={question.question_id} role="row" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 border-t border-brand-border px-3 py-4 first:border-t-0 hover:bg-brand-surface/30 @min-[500px]/bank:grid-cols-2 @min-[900px]/bank:table-row @min-[900px]/bank:border-t @min-[900px]/bank:p-0 @min-[900px]/bank:align-top">
                <td role="cell" className={`${cell} @min-[500px]/bank:col-span-2`}>
                  <p title={question.question_id} className="text-xs font-semibold text-brand-text/65">{shortId}</p>
                  <p className="mt-1 font-medium leading-5 wrap-anywhere">{question.question_preview}</p>
                </td>
                <td role="cell" className={cell}>
                  <span className={mobileLabel}>Certification / Category</span>
                  <p className="font-medium leading-5 wrap-anywhere">{question.certification_name}</p>
                  <p className="mt-1 text-xs leading-5 text-brand-text/75 wrap-anywhere">{question.category_name ?? "Uncategorized"}</p>
                </td>
                <td role="cell" className={cell}>
                  <span className={mobileLabel}>Type / Difficulty</span>
                  <p>{question.question_type === "multiple_choice" ? "MCQ" : "Short"}</p>
                  <p className="mt-1 text-xs capitalize text-brand-text/75">{question.difficulty}</p>
                </td>
                <td role="cell" className={cell}>
                  <span className={mobileLabel}>Status</span>
                  <span className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-center text-xs font-semibold leading-5 ${statusClasses(status)}`}>{status}</span>
                </td>
                <td role="cell" className={cell}>
                  <span className={mobileLabel}>Media / Updated</span>
                  {question.has_image ? <span className="inline-flex items-center gap-1.5"><ImageIcon aria-hidden="true" className="size-4 shrink-0" />Image</span> : <span className="text-xs text-brand-text/70">No image</span>}
                  <p className="mt-1 text-xs leading-5 text-brand-text/75">{dateLabel(question.last_updated)}</p>
                </td>
                <td role="cell" className={`${cell} @min-[500px]/bank:col-span-2`}>
                  <div role="group" aria-label={`Actions for ${shortId}`} className="grid min-w-0 grid-cols-1 gap-2 border-t border-brand-border pt-3 @min-[250px]/bank:grid-cols-2 @min-[900px]/bank:grid-cols-1 @min-[900px]/bank:border-0 @min-[900px]/bank:pt-0">
                    <Link href={href} prefetch={false} aria-label={`View ${shortId}`} className={`${actionLink} ${!canEdit ? "col-span-full" : ""}`}><Eye aria-hidden="true" className="size-4 shrink-0" />View</Link>
                    {canEdit && <Link href={`${href}/edit`} prefetch={false} aria-label={`Edit ${shortId}`} title={question.publication_status === "active" ? "Create a draft revision" : undefined} className={actionLink}><Pencil aria-hidden="true" className="size-4 shrink-0" />Edit</Link>}
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
        {items.length === 0 && <div className="space-y-3 p-6 text-center text-sm text-brand-text/75">
          <p>No questions match the current filters.</p>
          {hasFilters ? <><p>Try clearing filters or using a different search.</p><button type="button" className={actionLink} onClick={onClearFilters}>Clear search and filters</button></> : <p>New draft questions and imported questions will appear here.</p>}
        </div>}
      </div>
      <div className="flex min-w-0 flex-col gap-3 text-sm text-brand-text/80 @min-[580px]/bank:flex-row @min-[580px]/bank:items-center @min-[580px]/bank:justify-between">
        <p role="status">Showing {start}–{end} of {totalCount} questions</p>
        <nav aria-label="Question Bank pagination" className="flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className={pageButton}>‹</button>
          <span className="min-w-14 text-center font-medium">{page} / {pageCount}</span>
          <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} className={pageButton}>›</button>
          <span className="text-xs text-brand-text/70">{pageSize} / page</span>
        </nav>
      </div>
    </div>
  );
}
