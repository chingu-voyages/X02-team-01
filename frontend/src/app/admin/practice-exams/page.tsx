"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getAdminCategories,
  getAdminCertifications,
} from "@/lib/admin-catalog-api";
import {
  createAdminPracticeExam,
  getAdminPracticeExam,
  getAdminPracticeExams,
  practiceExamNotReadyDetail,
  setAdminPracticeExamPublication,
  updateAdminPracticeExam,
} from "@/lib/admin-practice-exam-api";

import type {
  AdminCategory,
  AdminCertification,
} from "@/types/admin-catalog-api.types";
import type {
  AdminPracticeExam,
  PracticeExamStatus,
} from "@/types/admin-practice-exam-api.types";

type LoadState = "loading" | "ready" | "error";
type StatusFilter = "all" | PracticeExamStatus;
type PublicationAction = "publish" | "unpublish";

function statusLabel(status: PracticeExamStatus): string {
  return status === "draft"
    ? "Draft"
    : status === "published"
      ? "Published"
      : "Unpublished";
}

function statusStyle(status: PracticeExamStatus): string {
  return status === "published"
    ? "border-[#b9c5bf] bg-[#e8eee9] text-[#30473a]"
    : status === "draft"
      ? "border-[#d5d9dd] bg-[#f1f2f3] text-[#495258]"
      : "border-[#d8d5d1] bg-[#f2efec] text-[#62564c]";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Administrator access is required to manage practice exams.";
  }
  return error instanceof Error ? error.message : fallback;
}

/** A keyboard-accessible confirmation step before changing learner availability. */
function PublicationConfirmation({
  exam,
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  exam: AdminPracticeExam;
  action: PublicationAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== "Tab") return;
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      previousFocus?.focus();
    };
  }, [busy, onCancel]);

  const publishing = action === "publish";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exam-confirm-title"
        aria-describedby="exam-confirm-description"
        className="w-full max-w-md rounded-lg border border-[#cbd0d3] bg-white p-6 shadow-xl"
      >
        <h2 id="exam-confirm-title" className="text-lg font-semibold text-[#292d30]">
          {publishing ? "Publish practice exam?" : "Unpublish practice exam?"}
        </h2>
        <p id="exam-confirm-description" className="mt-3 text-sm leading-6 text-[#606b72]">
          {publishing
            ? `Publish “${exam.name}” with ${exam.question_count ?? "the configured number of"} questions? Learners will be able to see and start it.`
            : `Unpublish “${exam.name}”? New learner attempts will be blocked. Started attempts can finish and completed results remain available.`}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-md border border-[#cbd0d3] px-4 py-2 text-sm font-semibold hover:bg-[#f2f3f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#202529] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {busy ? "Updating..." : publishing ? "Confirm publish" : "Confirm unpublish"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPracticeExamsPage() {
  const { token, role, ready, handleError } = useDemoSession();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [exams, setExams] = useState<AdminPracticeExam[]>([]);
  const [certifications, setCertifications] = useState<AdminCertification[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<AdminPracticeExam | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const countInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [certificationId, setCertificationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [questionCount, setQuestionCount] = useState("10");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [pending, setPending] = useState<{
    examId: string;
    action: PublicationAction;
  } | null>(null);
  const [changing, setChanging] = useState(false);
  const actionBusy = saving || refreshing || changing || pending !== null;
  const controlsLocked = showForm || actionBusy;
  const countOnly = editingExam?.status === "unpublished";

  useEffect(() => {
    if (showForm) {
      (countOnly ? countInputRef : nameInputRef).current?.focus();
    }
  }, [showForm, countOnly]);

  useEffect(() => {
    if (!ready || !token || role !== "administrator") return;
    let cancelled = false;

    Promise.all([
      getAdminPracticeExams(token),
      getAdminCertifications(token),
      getAdminCategories(token),
    ])
      .then(([allExams, allCertifications, allCategories]) => {
        if (cancelled) return;
        setExams(allExams);
        setCertifications(allCertifications);
        setCategories(allCategories);
        setCertificationId((current) => current || allCertifications[0]?.id || "");
        setSelectedId((current) =>
          current && allExams.some((exam) => exam.id === current)
            ? current
            : (allExams[0]?.id ?? null),
        );
        setLoadError("");
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        setLoadError(errorMessage(error, "Unable to load practice exams."));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, role, handleError, reloadKey]);

  const matchingCategories = useMemo(
    () => categories.filter((category) => category.certification_id === certificationId),
    [categories, certificationId],
  );

  const filteredExams = useMemo(() => {
    const term = search.trim().toLowerCase();
    return exams.filter((exam) => {
      if (statusFilter !== "all" && exam.status !== statusFilter) return false;
      return (
        !term ||
        [exam.name, exam.certification_name, exam.category_name].some((value) =>
          value.toLowerCase().includes(term),
        )
      );
    });
  }, [exams, search, statusFilter]);

  const selectedExam =
    filteredExams.find((exam) => exam.id === selectedId) ?? filteredExams[0] ?? null;
  const selectedCertification = certifications.find(
    (certification) => certification.id === selectedExam?.certification_id,
  );
  const pendingExam = exams.find((exam) => exam.id === pending?.examId) ?? null;

  function upsertExam(exam: AdminPracticeExam) {
    setExams((existing) => {
      const found = existing.some((item) => item.id === exam.id);
      return found
        ? existing.map((item) => (item.id === exam.id ? exam : item))
        : [exam, ...existing];
    });
  }

  async function refreshList() {
    if (!token || controlsLocked) return;
    setRefreshing(true);
    setActionError("");
    try {
      const results = await getAdminPracticeExams(token);
      setExams(results);
      setSelectedId((current) =>
        current && results.some((exam) => exam.id === current)
          ? current
          : (results[0]?.id ?? null),
      );
      setLoadError("");
      setLoadState("ready");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setActionError(errorMessage(error, "Unable to refresh practice exams."));
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshReadiness() {
    if (!token || !selectedExam || controlsLocked) return;
    setRefreshing(true);
    setActionError("");
    setSuccessMessage("");
    try {
      const updated = await getAdminPracticeExam(token, selectedExam.id);
      upsertExam(updated);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setActionError(errorMessage(error, "Unable to recheck publishing readiness."));
    } finally {
      setRefreshing(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingExam(null);
    setName("");
    setCertificationId(certifications[0]?.id ?? "");
    setCategoryId("");
    setQuestionCount("10");
    setFormError("");
  }

  function openEdit(exam: AdminPracticeExam) {
    if (controlsLocked || exam.status === "published") return;
    setEditingExam(exam);
    setName(exam.name);
    setCertificationId(exam.certification_id);
    setCategoryId(exam.category_id);
    setQuestionCount(exam.question_count === null ? "" : String(exam.question_count));
    setFormError("");
    setActionError("");
    setSuccessMessage("");
    setShowForm(true);
  }

  async function saveExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || role !== "administrator" || !showForm || actionBusy) return;
    const count = Number(questionCount);
    const normalizedName = countOnly && editingExam ? editingExam.name : name.trim();
    const certId = countOnly && editingExam ? editingExam.certification_id : certificationId;
    const catId = countOnly && editingExam ? editingExam.category_id : categoryId;
    if (
      !/^\d+$/.test(questionCount) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100
    ) {
      setFormError("Enter a whole-number question count from 1 to 100.");
      countInputRef.current?.focus();
      return;
    }
    if (
      !normalizedName ||
      normalizedName.length > 255 ||
      !certId ||
      !catId ||
      (!countOnly && !matchingCategories.some((item) => item.id === catId))
    ) {
      setFormError("Enter a valid name, certification, and category.");
      return;
    }

    setSaving(true);
    setFormError("");
    setActionError("");
    setSuccessMessage("");
    const payload = {
      name: normalizedName,
      certification_id: certId,
      category_id: catId,
      question_count: count,
    };
    try {
      const saved = editingExam
        ? await updateAdminPracticeExam(token, editingExam.id, payload)
        : await createAdminPracticeExam(token, payload);
      upsertExam(saved);
      setSelectedId(saved.id);
      setStatusFilter("all");
      setSearch("");
      closeForm();
      setSuccessMessage(
        editingExam
          ? `Changes saved for “${saved.name}”. Review readiness before publishing.`
          : `“${saved.name}” was created as a Draft. Review readiness before publishing.`,
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setFormError(errorMessage(error, editingExam ? "Unable to save practice exam changes." : "Unable to create the practice exam."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmPublication() {
    if (!token || changing || saving || refreshing || showForm || !pending || !pendingExam) return;
    setChanging(true);
    setActionError("");
    setSuccessMessage("");
    const publish = pending.action === "publish";
    try {
      const updated = await setAdminPracticeExamPublication(token, pending.examId, publish);
      upsertExam(updated);
      setPending(null);
      setStatusFilter("all");
      setSearch("");
      setSelectedId(updated.id);
      setSuccessMessage(
        publish
          ? `“${updated.name}” is now Published and available to learners.`
          : `“${updated.name}” is now Unpublished. New attempts are blocked.`,
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setPending(null);
        handleError(error);
        return;
      }
      const notReady =
        error instanceof ApiError ? practiceExamNotReadyDetail(error.detail) : null;
      if (notReady) {
        // The server's validation wins over any stale client readiness snapshot.
        upsertExam({ ...pendingExam, readiness: notReady.readiness });
        setActionError(notReady.message);
        setPending(null);
      } else {
        setActionError(errorMessage(error, "Unable to change exam publication."));
        setPending(null);
      }
    } finally {
      setChanging(false);
    }
  }

  if (!ready || !token) {
    return <p role="status" className="p-6 text-sm text-[#687178]">Checking session...</p>;
  }

  if (role !== "administrator") {
    return (
      <div role="alert" className="rounded-md border border-[#cfd2d5] bg-[#f6f6f6] p-6 text-sm">
        Administrator access is required to manage practice exams.
      </div>
    );
  }

  if (loadState === "loading") {
    return <p role="status" className="p-6 text-sm text-[#687178]">Loading practice exams...</p>;
  }

  if (loadState === "error") {
    return (
      <div className="rounded-md border border-[#d4d8db] bg-white p-6">
        <p role="alert" className="mb-4 text-sm text-red-700">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setReloadKey((current) => current + 1);
          }}
          className="min-h-11 rounded-md bg-[#343a3e] px-4 py-2 text-sm text-white"
        >
          Retry loading exams
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-6 text-[#292d30]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          stepLabel="JHEP-107 / JHEP-126"
          title="Practice exams"
          subtitle="Configure exam availability. Only published exams can be started by learners."
        />
        <button
          type="button"
          onClick={() => {
            if (showForm) closeForm();
            else {
              setFormError("");
              setActionError("");
              setSuccessMessage("");
              setShowForm(true);
            }
          }}
          disabled={actionBusy || editingExam !== null}
          aria-expanded={showForm && !editingExam}
          aria-controls="create-practice-exam"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#22282c] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Plus className="size-4" aria-hidden="true" />
          New exam
        </button>
      </div>

      {successMessage && (
        <p role="status" className="rounded-md border border-[#b8cbbd] bg-[#edf4ee] px-4 py-3 text-sm text-[#35583a]">
          {successMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-md border border-[#dfb9b7] bg-[#fff4f2] px-4 py-3 text-sm text-[#a02c27]">
          {actionError}
        </p>
      )}

      {showForm && (
        <form
          id={editingExam ? "edit-practice-exam" : "create-practice-exam"}
          aria-labelledby="exam-form-heading"
          aria-busy={saving}
          noValidate
          onSubmit={saveExam}
          className="min-w-0 rounded-md border border-[#cfd2d5] bg-white p-4 sm:p-5"
        >
          <h2 id="exam-form-heading" className="text-lg font-semibold">
            {editingExam ? "Edit practice exam" : "Create a practice exam"}
          </h2>
          <p className="mt-1 text-sm text-[#687178]">
            {countOnly
              ? "Only the question count can be changed for an unpublished exam. Existing attempts retain their original questions and order."
              : editingExam
                ? "Update this draft configuration. Saving does not publish the exam."
                : "Exams start as Draft. Publication requires valid configuration and enough published questions."}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="exam-name" className="block text-sm font-semibold">Exam name</label>
              <input
                id="exam-name"
                ref={nameInputRef}
                disabled={saving || countOnly}
                type="text"
                maxLength={255}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Science practice"
                className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-[#cbd0d3] px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="exam-certification" className="block text-sm font-semibold">Certification</label>
              <select
                id="exam-certification"
                disabled={saving || countOnly}
                value={certificationId}
                onChange={(event) => {
                  setCertificationId(event.target.value);
                  setCategoryId("");
                }}
                required
                className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-[#cbd0d3] bg-white px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select a certification</option>
                {certifications.map((certification) => (
                  <option key={certification.id} value={certification.id}>{certification.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exam-category" className="block text-sm font-semibold">Category</label>
              <select
                id="exam-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                required
                disabled={saving || countOnly || !certificationId || matchingCategories.length === 0}
                className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-[#cbd0d3] bg-white px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select a category</option>
                {matchingCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              {certificationId && matchingCategories.length === 0 && (
                <p className="mt-1 text-xs text-[#687178]">Create a category under Catalog first.</p>
              )}
            </div>
            <div>
              <label htmlFor="exam-question-count" className="block text-sm font-semibold">Question count (1–100)</label>
              <input
                id="exam-question-count"
                ref={countInputRef}
                disabled={saving}
                aria-describedby={formError ? "exam-count-help exam-form-error" : "exam-count-help"}
                type="number"
                min={1}
                max={100}
                step={1}
                required
                value={questionCount}
                onChange={(event) => setQuestionCount(event.target.value)}
                className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-[#cbd0d3] px-3 py-2 text-sm disabled:opacity-50"
              />
              <p id="exam-count-help" className="mt-1 text-xs text-[#687178]">Enter a whole number from 1 to 100. Changes apply to future attempts only.</p>
            </div>
          </div>
          {formError && (
            <p id="exam-form-error" role="alert" className="mt-4 text-sm text-red-700">{formError}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="min-h-11 rounded-md border border-[#cbd0d3] px-4 py-2 text-sm font-semibold hover:bg-[#f2f3f4]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy || (!countOnly && (certifications.length === 0 || matchingCategories.length === 0))}
              className="min-h-11 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#22282c] disabled:opacity-50"
            >
              {saving ? (editingExam ? "Saving..." : "Creating...") : editingExam ? "Save changes" : "Create draft"}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.95fr)_minmax(0,1.3fr)]">
        <section aria-labelledby="exam-list-heading" className="min-w-0 rounded-md border border-[#cfd2d5] bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 id="exam-list-heading" className="text-lg font-semibold">All practice exams</h2>
            <button
              type="button"
              disabled={controlsLocked}
              onClick={() => void refreshList()}
              aria-label="Refresh exam list"
              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-[#cbd0d3] px-3 py-2 text-xs font-semibold hover:bg-[#f1f2f3] disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
            </button>
          </div>
          <label htmlFor="exam-search" className="sr-only">Search practice exams</label>
          <input
            id="exam-search"
            disabled={controlsLocked}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search exams, certifications, categories"
            className="mt-4 min-h-11 w-full rounded-md border border-[#cbd0d3] px-3 py-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {(["all", "draft", "published", "unpublished"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                disabled={controlsLocked}
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
                className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  statusFilter === filter ? "bg-[#343a3e] text-white" : "bg-[#eceeef] text-[#4b545a] hover:bg-[#dfe2e3]"
                }`}
              >
                {filter === "all" ? "All" : statusLabel(filter)}
              </button>
            ))}
          </div>
          {filteredExams.length === 0 ? (
            <p className="mt-5 rounded-md bg-[#f3f4f5] p-4 text-sm text-[#687178]">
              {exams.length === 0
                ? "No practice exams yet. Create a Draft to get started."
                : "No practice exams match these filters."}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {filteredExams.map((exam) => (
                <li key={exam.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(exam.id);
                      setActionError("");
                      setSuccessMessage("");
                    }}
                    disabled={controlsLocked}
                    aria-current={selectedExam?.id === exam.id ? "true" : undefined}
                    aria-label={`Manage ${exam.name}`}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      selectedExam?.id === exam.id
                        ? "border-[#343a3e] bg-[#f3f4f5]"
                        : "border-[#d7dadd] bg-white hover:bg-[#f6f7f8]"
                    }`}
                  >
                    <span className="min-w-0 space-y-2">
                      <span className="block truncate text-sm font-semibold">{exam.name}</span>
                      <span className="block text-xs text-[#687178]">{exam.certification_name} · {exam.category_name}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-2 py-1 text-xs font-semibold ${statusStyle(exam.status)}`}>
                          {statusLabel(exam.status)}
                        </span>
                        <span className="text-xs text-[#687178]">{exam.question_count ?? "—"} questions</span>
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#7c8388]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="exam-details-heading" className="min-w-0 rounded-md border border-[#cfd2d5] bg-white p-4 sm:p-5">
          {selectedExam ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="exam-details-heading" className="text-xl font-semibold">{selectedExam.name}</h2>
                  <p className="mt-1 text-xs text-[#687178]">Exam details and publication readiness</p>
                </div>
                <span className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusStyle(selectedExam.status)}`}>
                  {statusLabel(selectedExam.status)}
                </span>
              </div>

              <div className="rounded-md border border-[#d9dde0] bg-[#f6f7f8] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Configuration</h3>
                  {selectedExam.status !== "published" && (
                    <button
                      type="button"
                      disabled={controlsLocked}
                      onClick={() => openEdit(selectedExam)}
                      className="min-h-11 rounded-md border border-[#cbd0d3] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#f2f3f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                    >
                      Edit exam
                    </button>
                  )}
                </div>
                {selectedExam.status === "published" && (
                  <p className="mb-3 text-xs text-[#687178]">Unpublish the exam before editing its question count.</p>
                )}
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 text-sm">
                  <dt className="text-[#687178]">Certification</dt>
                  <dd className="text-right font-medium">{selectedExam.certification_name}</dd>
                  <dt className="text-[#687178]">Category</dt>
                  <dd className="text-right font-medium">{selectedExam.category_name}</dd>
                  <dt className="text-[#687178]">Question count</dt>
                  <dd className="text-right font-medium">{selectedExam.question_count ?? "Not configured"}</dd>
                  <dt className="text-[#687178]">Passing threshold</dt>
                  <dd className="text-right font-medium">
                    {selectedCertification?.passing_threshold_pct === null ||
                    selectedCertification?.passing_threshold_pct === undefined
                      ? "Not configured"
                      : `${selectedCertification.passing_threshold_pct}%`}
                  </dd>
                  <dt className="text-[#687178]">Eligible published questions</dt>
                  <dd className="text-right font-medium">{selectedExam.readiness.eligible_question_count}</dd>
                </dl>
              </div>

              <div className="rounded-md border border-[#d9dde0] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">Publication readiness</h3>
                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => void refreshReadiness()}
                    className="text-xs font-semibold text-[#414b52] underline underline-offset-2 hover:text-black disabled:opacity-50"
                  >
                    Recheck readiness
                  </button>
                </div>
                {selectedExam.readiness.ready ? (
                  <div className="mt-4 flex gap-2 text-sm text-[#35583a]">
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <p>Ready to publish. The required configuration and eligible question pool are valid.</p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[#91522d]">
                      <AlertCircle aria-hidden="true" className="size-4" /> Requirements not met
                    </p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#59636b]">
                      {selectedExam.readiness.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {selectedExam.status === "published" ? (
                <div className="space-y-2">
                  <p className="text-xs text-[#687178]">This exam is visible and startable by learners while available.</p>
                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => setPending({ examId: selectedExam.id, action: "unpublish" })}
                    className="min-h-11 w-full rounded-md bg-[#343a3e] px-4 py-3 text-sm font-semibold text-white hover:bg-[#22282c] disabled:opacity-50"
                  >
                    Unpublish exam
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={!selectedExam.readiness.ready || controlsLocked}
                    onClick={() => setPending({ examId: selectedExam.id, action: "publish" })}
                    className="min-h-11 w-full rounded-md bg-[#343a3e] px-4 py-3 text-sm font-semibold text-white hover:bg-[#22282c] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Publish exam
                  </button>
                  {!selectedExam.readiness.ready && (
                    <p className="text-xs text-[#687178]">Resolve the requirements above before publishing.</p>
                  )}
                </div>
              )}
              <p className="text-xs leading-5 text-[#687178]">
                Unpublishing blocks new attempts. Attempts already started can finish and previously completed results remain intact.
              </p>
            </div>
          ) : (
            <div>
              <h2 id="exam-details-heading" className="text-lg font-semibold">Exam details</h2>
              <p className="mt-3 text-sm text-[#687178]">Select an exam to inspect its configuration and readiness.</p>
            </div>
          )}
        </section>
      </div>

      {pending && pendingExam && (
        <PublicationConfirmation
          exam={pendingExam}
          action={pending.action}
          busy={changing}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmPublication()}
        />
      )}
    </section>
  );
}
