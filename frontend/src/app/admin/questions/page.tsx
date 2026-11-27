"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Search, SlidersHorizontal } from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import QuestionBankResults from "@/features/questions/QuestionBankResults";
import { getAdminCategories, getAdminCertifications } from "@/lib/admin-catalog-api";
import { getManagedQuestions } from "@/lib/admin-question-api";
import { ApiError } from "@/lib/api-client";
import type { AdminCategory, AdminCertification } from "@/types/admin-catalog-api.types";
import type {
  AdminDifficulty,
  AdminQuestionBankListResponse,
  AdminQuestionBankQuery,
  AdminQuestionType,
} from "@/types/admin-question-api.types";

type WorkflowFilter = "all" | "pending" | "submitted" | "in_review" | "approved_draft" | "rejected" | "published" | "retired";
type MediaFilter = "all" | "with_image" | "without_image";
type Filters = {
  certification: string;
  category: string;
  questionType: "all" | AdminQuestionType;
  difficulty: "all" | AdminDifficulty;
  workflow: WorkflowFilter;
  media: MediaFilter;
};
type RequestState<T> = {
  token: string;
  key: string;
} & ({ status: "ready"; data: T } | { status: "error" | "forbidden"; message: string });
type Catalog = { certifications: AdminCertification[]; categories: AdminCategory[] };
type Option = { value: string; label: string };

const pageSize = 50;
const emptyFilters: Filters = {
  certification: "all", category: "all", questionType: "all",
  difficulty: "all", workflow: "all", media: "all",
};
const secondaryButton = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md border border-brand-border bg-white px-4 py-2 text-center text-sm font-semibold text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function workflowQuery(workflow: WorkflowFilter): Pick<AdminQuestionBankQuery, "review_status" | "publication_status"> {
  switch (workflow) {
    case "pending": case "submitted": case "in_review": case "rejected":
      return { review_status: workflow };
    case "approved_draft": return { review_status: "approved", publication_status: "draft" };
    case "published": return { publication_status: "active" };
    case "retired": return { publication_status: "retired" };
    default: return {};
  }
}

// Presentation only: the server authorizes every question operation.
function userIdFromToken(token: string | null): string | null {
  try {
    const encoded = token?.split(".")[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function SelectFilter({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-xs font-semibold text-brand-text/80">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        className="min-h-11 w-full min-w-0 cursor-pointer rounded-md border border-brand-border bg-white px-3 py-2 text-base text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm">
        {!options.some((option) => option.value === value) && <option value={value}>Selected value (unavailable)</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export default function AdminQuestionsPage() {
  const { token, role, ready, handleError } = useDemoSession();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [bankState, setBankState] = useState<RequestState<AdminQuestionBankListResponse> | null>(null);
  const [catalogState, setCatalogState] = useState<RequestState<Catalog> | null>(null);
  const filtersId = useId();
  const resultsId = useId();
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const timeout = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, search]);

  const catalogKey = String(catalogReloadKey);
  const catalog = catalogState?.token === token && catalogState.key === catalogKey ? catalogState : null;
  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    Promise.all([getAdminCertifications(token), getAdminCategories(token)])
      .then(([certifications, categories]) => {
        if (!cancelled) setCatalogState({ token, key: catalogKey, status: "ready", data: { certifications, categories } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        setCatalogState({ token, key: catalogKey, status: "error", message: "Catalog filters could not be loaded. You can still search and use the other filters." });
      });
    return () => { cancelled = true; };
  }, [ready, token, catalogKey, handleError]);

  const query = useMemo<AdminQuestionBankQuery>(() => ({
    page, page_size: pageSize, ...workflowQuery(filters.workflow),
    ...(search ? { search } : {}),
    ...(filters.certification !== "all" ? { certification_id: filters.certification } : {}),
    ...(filters.category !== "all" ? { category_id: filters.category } : {}),
    ...(filters.questionType !== "all" ? { question_type: filters.questionType } : {}),
    ...(filters.difficulty !== "all" ? { difficulty: filters.difficulty } : {}),
    ...(filters.media !== "all" ? { has_image: filters.media === "with_image" } : {}),
  }), [page, search, filters]);
  const requestKey = JSON.stringify([reloadKey, query]);
  const bank = bankState?.token === token && bankState.key === requestKey ? bankState : null;

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    getManagedQuestions(token, query)
      .then((response) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(response.count / pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setBankState({ token, key: requestKey, status: "ready", data: response });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setBankState({ token, key: requestKey, status: "forbidden", message: "Your account does not have permission to manage the question bank." });
          return;
        }
        setBankState({ token, key: requestKey, status: "error", message: "Unable to load questions. Check your connection and try again. Your search and filters have been kept." });
      });
    return () => { cancelled = true; };
  }, [ready, token, requestKey, query, page, handleError]);

  const catalogData = catalog?.status === "ready" ? catalog.data : null;
  const visibleCategories = useMemo(() => (catalogData?.categories ?? [])
    .filter((category) => filters.certification === "all" || category.certification_id === filters.certification)
    .sort((left, right) => left.name.localeCompare(right.name)), [catalogData, filters.certification]);
  const activeFilters = Object.values(filters).filter((value) => value !== "all").length;
  const hasFilters = activeFilters > 0 || searchInput.trim() !== "" || search !== "";
  const searchPending = searchInput.trim() !== search;
  const forbidden = bank?.status === "forbidden" || role === "learner";
  const canManage = !forbidden && (role === "administrator" || role === "contributor");

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value, ...(key === "certification" ? { category: "all" } : {}) }));
    setPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setFilters(emptyFilters);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    resultsHeadingRef.current?.focus();
  }

  if (!ready || !token) return <p role="status">Checking session...</p>;

  return (
    <section className="@container/bank min-w-0 space-y-5 wrap-anywhere">
      <div className="flex min-w-0 flex-col gap-4 @min-[740px]/bank:flex-row @min-[740px]/bank:items-start @min-[740px]/bank:justify-between">
        <div className="min-w-0">
          <PageHeader stepLabel="Content management" title="Question Bank" subtitle="Search, filter and manage practice questions across the bank." />
        </div>
        {canManage && <div className="flex min-w-0 flex-col gap-2 @min-[430px]/bank:flex-row @min-[740px]/bank:shrink-0">
          <Link href="/admin/questions/import" className={secondaryButton}>Import Questions</Link>
          <Link href="/admin/questions/new" className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-md bg-brand-accent px-4 py-2 text-center text-sm font-semibold text-brand-text hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2">+ Create Question</Link>
        </div>}
      </div>

      {forbidden ? <div role="alert" className="rounded-md border border-brand-border bg-brand-surface p-5">
        <h2 className="font-semibold">Access denied</h2>
        <p className="mt-2 text-sm text-brand-text/80">Your account does not have permission to manage the question bank.</p>
      </div> : <>
        <section aria-label="Question Bank filters" className="min-w-0 space-y-3 rounded-md border border-brand-border bg-white p-3 sm:p-4">
          <label className="relative block min-w-0">
            <span className="sr-only">Search questions</span>
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-text/60" />
            <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search question text, certification, category or full ID"
              className="min-h-11 w-full min-w-0 rounded-md border border-brand-border bg-white py-2 pl-9 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:text-sm" />
          </label>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <button type="button" className={`${secondaryButton} @min-[640px]/bank:hidden`} aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0" /> Filters{activeFilters > 0 ? ` (${activeFilters} active)` : ""}
              <ChevronDown aria-hidden="true" className={`size-4 shrink-0 ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            <p className="hidden text-sm font-medium text-brand-text/80 @min-[640px]/bank:block">Filters{activeFilters ? ` (${activeFilters} active)` : ""}</p>
            <button type="button" disabled={!hasFilters} onClick={clearFilters} className={secondaryButton}>Clear filters</button>
          </div>
          {catalog?.status === "error" && <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>{catalog.message}</p>
            <button type="button" className={secondaryButton} onClick={() => setCatalogReloadKey((value) => value + 1)}>Retry catalog filters</button>
          </div>}
          <div id={filtersId} className={`${filtersOpen ? "grid" : "hidden @min-[640px]/bank:grid"} min-w-0 grid-cols-1 gap-3 @min-[440px]/bank:grid-cols-2 @min-[760px]/bank:grid-cols-3`}>
            <SelectFilter label="Certification" value={filters.certification} disabled={!catalogData}
              options={[{ value: "all", label: "All Certifications" }, ...(catalogData?.certifications ?? []).map((item) => ({ value: item.id, label: item.name }))]}
              onChange={(value) => updateFilter("certification", value)} />
            <SelectFilter label="Category" value={filters.category} disabled={!catalogData}
              options={[{ value: "all", label: "All Categories" }, ...visibleCategories.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={(value) => updateFilter("category", value)} />
            <SelectFilter label="Question type" value={filters.questionType} options={[{ value: "all", label: "All Types" }, { value: "multiple_choice", label: "Multiple Choice" }, { value: "short_answer", label: "Short Answer" }]} onChange={(value) => updateFilter("questionType", value as Filters["questionType"])} />
            <SelectFilter label="Difficulty" value={filters.difficulty} options={[{ value: "all", label: "All Difficulties" }, { value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]} onChange={(value) => updateFilter("difficulty", value as Filters["difficulty"])} />
            <SelectFilter label="Workflow status" value={filters.workflow} options={[{ value: "all", label: "All Workflow States" }, { value: "pending", label: "Draft (not submitted)" }, { value: "submitted", label: "Submitted" }, { value: "in_review", label: "In Review" }, { value: "approved_draft", label: "Approved Draft" }, { value: "rejected", label: "Rejected" }, { value: "published", label: "Published" }, { value: "retired", label: "Retired" }]} onChange={(value) => updateFilter("workflow", value as WorkflowFilter)} />
            <SelectFilter label="Media" value={filters.media} options={[{ value: "all", label: "All Media" }, { value: "with_image", label: "With Image" }, { value: "without_image", label: "Without Image" }]} onChange={(value) => updateFilter("media", value as MediaFilter)} />
            {!catalog && <p role="status" className="text-xs text-brand-text/70">Loading certification and category options...</p>}
          </div>
        </section>
        <section aria-labelledby={resultsId} className="min-w-0 space-y-3">
          <h2 id={resultsId} ref={resultsHeadingRef} tabIndex={-1} className="scroll-mt-24 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">Questions</h2>
          {!bank || searchPending ? <div role="status" className="flex min-w-0 items-center gap-3 rounded-md border border-brand-border bg-white p-5 text-sm text-brand-text/80">
            <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" /> {bankState?.token === token ? "Updating questions..." : "Loading question bank..."}
          </div> : bank.status === "error" ? <div role="alert" className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <div className="flex items-start gap-2"><AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><p>{bank.message}</p></div>
            <button type="button" className={secondaryButton} onClick={() => setReloadKey((value) => value + 1)}>Retry</button>
          </div> : bank.status === "ready" && <QuestionBankResults items={bank.data.items} totalCount={bank.data.count} page={page} pageSize={pageSize} onPageChange={changePage} role={role} userId={userIdFromToken(token)} hasFilters={hasFilters} onClearFilters={clearFilters} />}
        </section>
      </>}
    </section>
  );
}
