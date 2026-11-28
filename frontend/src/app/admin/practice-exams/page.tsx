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
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
  deleteAdminPracticeExam,
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
type ExamAction = "publish" | "unpublish" | "delete";
type FieldKey = "name" | "certification" | "category" | "questionCount";
type FieldErrors = Partial<Record<FieldKey, string>>;
type ActionProblem = {
  area: "list" | "details" | "delete";
  title: string;
  message: string;
  examId?: string;
  refreshList?: boolean;
};

const fieldOrder: FieldKey[] = ["name", "certification", "category", "questionCount"];
const fieldMessages: Record<FieldKey, string> = {
  name: "Enter an exam name (1–255 characters).",
  certification: "Select a certification.",
  category: "Select a category in the chosen certification.",
  questionCount: "Enter a whole-number question count from 1 to 100.",
};

const apiFieldNames: Record<string, FieldKey> = {
  name: "name",
  certification_id: "certification",
  category_id: "category",
  question_count: "questionCount",
};

function validationErrors(error: unknown, countOnly: boolean): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  if (!countOnly && error.status === 409 && (
    error.detail === "Exam name already exists in category" ||
    error.message === "Exam name already exists in category"
  )) {
    return { name: "An exam with this name already exists in this category. Choose another name." };
  }
  if (error.status !== 422 || !Array.isArray(error.detail)) return {};
  const errors: FieldErrors = {};
  for (const issue of error.detail) {
    if (!issue || typeof issue !== "object" || !Array.isArray(issue.loc)) continue;
    const apiField = issue.loc[issue.loc.length - 1];
    if (typeof apiField !== "string" || !Object.prototype.hasOwnProperty.call(apiFieldNames, apiField)) continue;
    const field = apiFieldNames[apiField];
    if (field && (!countOnly || field === "questionCount")) errors[field] = fieldMessages[field];
  }
  return errors;
}

function fieldClass(invalid: boolean): string {
  return `mt-2 min-h-11 w-full min-w-0 scroll-mt-24 rounded-md border bg-white px-3 py-2 text-base sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
    invalid ? "border-red-600 focus-visible:outline-red-600" : "border-[#cbd0d3] focus-visible:outline-[#343a3e]"
  }`;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-sm font-medium text-red-700">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
    </p>
  );
}

function ErrorNotice({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
        <p className="font-semibold">{title}</p>
        <p>{message}</p>
      </div>
    </div>
  );
}

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
  if (error instanceof ApiError && error.status === 422) {
    return "Check the exam configuration and try again.";
  }
  if (error instanceof ApiError && error.status >= 500) {
    return `${fallback} The service is temporarily unavailable. Try again in a moment.`;
  }
  if (error instanceof TypeError) {
    return `${fallback} Check your connection and try again.`;
  }
  return error instanceof Error ? error.message : fallback;
}

/** Confirm publication changes or permanent deletion with keyboard support. */
function ExamActionConfirmation({
  exam,
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  exam: AdminPracticeExam;
  action: ExamAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== "Tab") return;
      if (busy) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
    };
  }, [busy, onCancel]);

  const publishing = action === "publish";
  const deleting = action === "delete";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        aria-busy={busy}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exam-confirm-title"
        aria-describedby="exam-confirm-description"
        className="max-h-[calc(100dvh_-_2rem)] w-full min-w-0 max-w-md overflow-y-auto rounded-lg border border-[#cbd0d3] bg-white p-4 shadow-xl [overflow-wrap:anywhere] sm:p-6"
      >
        <h2 id="exam-confirm-title" className="flex items-center gap-2 text-lg font-semibold text-[#292d30]">
          {deleting && <Trash2 aria-hidden="true" className="size-5 shrink-0 text-red-700" />}
          {deleting ? "Delete practice exam?" : publishing ? "Publish practice exam?" : "Unpublish practice exam?"}
        </h2>
        {deleting ? (
          <div id="exam-confirm-description" className="mt-3 space-y-3 text-sm leading-6 text-[#606b72]">
            <p>Permanently delete <strong className="text-[#292d30]">{exam.name}</strong>?</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-md bg-[#f3f4f5] p-3">
              <dt>Status</dt><dd className="text-right font-semibold">{statusLabel(exam.status)}</dd>
              <dt>Question count</dt><dd className="text-right font-semibold">{exam.question_count ?? "Not configured"}</dd>
            </dl>
            <p>This removes only the exam configuration, not the questions, certification, or category. The server prevents deletion of exams with learner history.</p>
            <p className="font-semibold text-red-800">This action cannot be undone.</p>
          </div>
        ) : (
          <p id="exam-confirm-description" className="mt-3 text-sm leading-6 text-[#606b72]">
            {publishing
              ? `Publish “${exam.name}” with ${exam.question_count ?? "the configured number of"} questions? Learners will be able to see and start it.`
              : `Unpublish “${exam.name}”? New learner attempts will be blocked. Started attempts can finish and completed results remain available.`}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
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
            className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${deleting ? "bg-red-700 hover:bg-red-800" : "bg-[#343a3e] hover:bg-[#202529]"}`}
          >
            {deleting ? (busy ? "Deleting..." : "Confirm delete") : busy ? "Updating..." : publishing ? "Confirm publish" : "Confirm unpublish"}
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
  // A list read started before an acknowledged write must not undo it.
  const examListRevisionRef = useRef(0);
  const [certifications, setCertifications] = useState<AdminCertification[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<ActionProblem | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"list" | "details">("list");
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const mobileFocusRef = useRef<"list" | "details" | null>(null);
  const [successMessage, setSuccessMessage] = useState<{
    examId: string;
    message: string;
  } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<AdminPracticeExam | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const countInputRef = useRef<HTMLInputElement>(null);
  const certificationInputRef = useRef<HTMLSelectElement>(null);
  const categoryInputRef = useRef<HTMLSelectElement>(null);
  const formFeedbackRef = useRef<HTMLDivElement>(null);
  const focusProblemRef = useRef<"fields" | "form" | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterFormRef = useRef<"trigger" | "details" | null>(null);
  const [name, setName] = useState("");
  const [certificationId, setCertificationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [questionCount, setQuestionCount] = useState("10");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const [pending, setPending] = useState<{
    examId: string;
    action: ExamAction;
  } | null>(null);
  const [changing, setChanging] = useState(false);
  const [protectedExams, setProtectedExams] = useState<Record<string, boolean>>({});
  const [deletionNotice, setDeletionNotice] = useState("");
  const deleteRequestRef = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deletionFocusRef = useRef<"list" | "trigger" | null>(null);
  const actionBusy = saving || refreshing || changing || pending !== null;
  const controlsLocked = showForm || actionBusy;
  const countOnly = editingExam?.status === "unpublished";
  const availableQuestionCount =
    editingExam &&
    editingExam.certification_id === certificationId &&
    editingExam.category_id === categoryId
      ? editingExam.readiness.eligible_question_count
      : null;
  const exceedsAvailableQuestions =
    availableQuestionCount !== null &&
    /^\d+$/.test(questionCount) &&
    Number(questionCount) <= 100 &&
    Number(questionCount) > availableQuestionCount;
  const hasFieldErrors = fieldOrder.some((field) => Boolean(fieldErrors[field]));
  const countError = fieldErrors.questionCount;

  useEffect(() => {
    if (actionError && !actionBusy && !showForm) actionErrorRef.current?.focus();
  }, [actionError, actionBusy, showForm]);

  useEffect(() => {
    if (!showForm || saving || !focusProblemRef.current) return;
    const target = focusProblemRef.current;
    focusProblemRef.current = null;
    if (target === "fields") {
      const refs = {
        name: nameInputRef,
        certification: certificationInputRef,
        category: categoryInputRef,
        questionCount: countInputRef,
      };
      for (const field of fieldOrder) {
        const input = refs[field].current;
        if (fieldErrors[field] && input && !input.disabled) {
          input.focus();
          return;
        }
      }
    }
    formFeedbackRef.current?.focus();
  }, [showForm, saving, fieldErrors, formError]);

  useEffect(() => {
    if (showForm) {
      (countOnly ? countInputRef : nameInputRef).current?.focus();
    }
  }, [showForm, countOnly]);

  useEffect(() => {
    if (showForm || actionBusy || !focusAfterFormRef.current) return;
    const destination = focusAfterFormRef.current;
    focusAfterFormRef.current = null;
    if (destination === "trigger" && returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
    } else {
      detailsHeadingRef.current?.focus();
    }
    returnFocusRef.current = null;
  }, [showForm, actionBusy]);

  useEffect(() => {
    if (!ready || !token || role !== "administrator") return;
    let cancelled = false;
    const revisionAtStart = examListRevisionRef.current;

    Promise.all([
      getAdminPracticeExams(token),
      getAdminCertifications(token),
      getAdminCategories(token),
    ])
      .then(([allExams, allCertifications, allCategories]) => {
        if (cancelled || revisionAtStart !== examListRevisionRef.current) return;
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
        if (cancelled || revisionAtStart !== examListRevisionRef.current) return;
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
  const selectedExamProtected = selectedExam ? Boolean(protectedExams[selectedExam.id]) : false;

  useEffect(() => {
    if (actionBusy || !deletionFocusRef.current) return;
    const destination = deletionFocusRef.current;
    deletionFocusRef.current = null;
    if (destination === "list") listHeadingRef.current?.focus();
    else deleteTriggerRef.current?.focus();
  }, [actionBusy]);

  useEffect(() => {
    if (showForm || !mobileFocusRef.current) return;
    const destination = mobileFocusRef.current;
    mobileFocusRef.current = null;
    (destination === "list" ? listHeadingRef : detailsHeadingRef).current?.focus();
  }, [mobilePanel, selectedExam?.id, showForm]);

  function selectExam(examId: string) {
    if (controlsLocked) return;
    if (window.matchMedia?.("(width < 80rem)").matches) {
      mobileFocusRef.current = "details";
    }
    setMobilePanel("details");
    setSelectedId(examId);
    setActionError(null);
    setSuccessMessage(null);
    setDeletionNotice("");
  }

  function backToList() {
    mobileFocusRef.current = "list";
    setMobilePanel("list");
    setActionError(null);
  }

  function clearFieldError(...fields: FieldKey[]) {
    setFieldErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  function clearFormFeedback() {
    setFormError("");
    setFieldErrors({});
    focusProblemRef.current = null;
  }

  function showFieldErrors(errors: FieldErrors) {
    focusProblemRef.current = "fields";
    setFieldErrors(errors);
    setFormError("");
  }

  function upsertExam(exam: AdminPracticeExam) {
    examListRevisionRef.current += 1;
    setExams((existing) => {
      const found = existing.some((item) => item.id === exam.id);
      return found
        ? existing.map((item) => (item.id === exam.id ? exam : item))
        : [exam, ...existing];
    });
  }

  async function refreshList() {
    if (!token || controlsLocked) return;
    const revisionAtStart = examListRevisionRef.current;
    setRefreshing(true);
    setSuccessMessage(null);
    setActionError(null);
    setDeletionNotice("");
    try {
      const results = await getAdminPracticeExams(token);
      if (revisionAtStart !== examListRevisionRef.current) return;
      examListRevisionRef.current += 1;
      setExams(results);
      setSelectedId((current) =>
        current && results.some((exam) => exam.id === current)
          ? current
          : (results[0]?.id ?? null),
      );
      setLoadError("");
      setLoadState("ready");
    } catch (error: unknown) {
      if (revisionAtStart !== examListRevisionRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setMobilePanel("list");
      setActionError({ area: "list", title: "Could not refresh exams", message: errorMessage(error, "Unable to refresh practice exams.") });
    } finally {
      setRefreshing(false);
    }
  }

  function refreshAfterDeletionIssue() {
    if (controlsLocked) return;
    setMobilePanel("list");
    mobileFocusRef.current = "list";
    void refreshList();
  }

  async function refreshReadiness() {
    if (!token || !selectedExam || controlsLocked) return;
    setRefreshing(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updated = await getAdminPracticeExam(token, selectedExam.id);
      upsertExam(updated);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      setMobilePanel("details");
      setActionError({ area: "details", title: "Could not check readiness", message: errorMessage(error, "Unable to recheck publishing readiness.") });
    } finally {
      setRefreshing(false);
    }
  }

  function closeForm(focusTarget: "trigger" | "details" = "trigger") {
    focusAfterFormRef.current = focusTarget;
    setShowForm(false);
    setEditingExam(null);
    setName("");
    setCertificationId(certifications[0]?.id ?? "");
    setCategoryId("");
    setQuestionCount("10");
    clearFormFeedback();
  }

  function openEdit(exam: AdminPracticeExam, trigger: HTMLButtonElement) {
    if (controlsLocked || exam.status === "published") return;
    returnFocusRef.current = trigger;
    setEditingExam(exam);
    setDeletionNotice("");
    setName(exam.name);
    setCertificationId(exam.certification_id);
    setCategoryId(exam.category_id);
    setQuestionCount(exam.question_count === null ? "" : String(exam.question_count));
    setMobilePanel("details");
    clearFormFeedback();
    setActionError(null);
    setSuccessMessage(null);
    setShowForm(true);
  }

  async function saveExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || role !== "administrator" || !showForm || actionBusy) return;
    const count = Number(questionCount);
    const normalizedName = countOnly && editingExam ? editingExam.name : name.trim();
    const certId = countOnly && editingExam ? editingExam.certification_id : certificationId;
    const catId = countOnly && editingExam ? editingExam.category_id : categoryId;
    const errors: FieldErrors = {};
    if (!countOnly) {
      if (!normalizedName || normalizedName.length > 255) errors.name = fieldMessages.name;
      if (!certId || !certifications.some((item) => item.id === certId)) errors.certification = fieldMessages.certification;
      if (!catId || !matchingCategories.some((item) => item.id === catId)) {
        errors.category = certId && matchingCategories.length === 0
          ? "Create a category under Catalog before saving this exam."
          : fieldMessages.category;
      }
    }
    if (!/^\d+$/.test(questionCount) || !Number.isInteger(count) || count < 1 || count > 100) {
      errors.questionCount = fieldMessages.questionCount;
    }
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors);
      return;
    }

    setSaving(true);
    clearFormFeedback();
    setActionError(null);
    setSuccessMessage(null);
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
      setMobilePanel("details");
      closeForm("details");
      setSuccessMessage({
        examId: saved.id,
        message: editingExam
          ? `Changes saved for “${saved.name}”. Review readiness before publishing.`
          : `“${saved.name}” was created as a Draft. Review readiness before publishing.`,
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      const errors = validationErrors(error, countOnly);
      if (Object.keys(errors).length > 0) {
        showFieldErrors(errors);
      } else {
        focusProblemRef.current = "form";
        const message = errorMessage(error, editingExam ? "Unable to save practice exam changes." : "Unable to create the practice exam.");
        setFormError(error instanceof ApiError && (error.status === 404 || error.status === 409)
          ? `${message} Your entries are still here. If the exam or catalog changed, cancel and refresh before trying again.`
          : `${message} Your entries are still here.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmPublication() {
    if (!token || changing || saving || refreshing || showForm || !pending || !pendingExam || pending.action === "delete") return;
    setChanging(true);
    setActionError(null);
    setSuccessMessage(null);
    const publish = pending.action === "publish";
    try {
      const updated = await setAdminPracticeExamPublication(token, pending.examId, publish);
      upsertExam(updated);
      setPending(null);
      setStatusFilter("all");
      setSearch("");
      setSelectedId(updated.id);
      setMobilePanel("details");
      setSuccessMessage({
        examId: updated.id,
        message: publish
          ? `“${updated.name}” is now Published and available to learners.`
          : `“${updated.name}” is now Unpublished. New attempts are blocked.`,
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setPending(null);
        handleError(error);
        return;
      }
      setMobilePanel("details");
      const notReady =
        error instanceof ApiError ? practiceExamNotReadyDetail(error.detail) : null;
      if (notReady) {
        // The server's validation wins over any stale client readiness snapshot.
        upsertExam({ ...pendingExam, readiness: notReady.readiness });
        setActionError({ area: "details", title: "Exam cannot be published", message: notReady.message });
        setPending(null);
      } else {
        setActionError({ area: "details", title: publish ? "Could not publish exam" : "Could not unpublish exam", message: errorMessage(error, "Unable to change exam publication.") });
        setPending(null);
      }
    } finally {
      setChanging(false);
    }
  }

  function requestDeletion(exam: AdminPracticeExam) {
    if (controlsLocked || role !== "administrator" || exam.status === "published" || protectedExams[exam.id]) return;
    setActionError(null);
    setSuccessMessage(null);
    setDeletionNotice("");
    setPending({ examId: exam.id, action: "delete" });
  }

  function cancelAction() {
    if (changing || deleteRequestRef.current) return;
    if (pending?.action === "delete") deletionFocusRef.current = "trigger";
    setPending(null);
  }

  async function confirmDeletion() {
    if (!token || role !== "administrator" || changing || saving || refreshing || showForm || deleteRequestRef.current || pending?.action !== "delete" || !pendingExam) return;
    if (pendingExam.status === "published" || protectedExams[pendingExam.id]) {
      setPending(null);
      return;
    }
    const target = pendingExam;
    deleteRequestRef.current = true;
    setChanging(true);
    setActionError(null);
    setSuccessMessage(null);
    setDeletionNotice("");
    try {
      await deleteAdminPracticeExam(token, target.id);
      // Remove only the exact exam acknowledged by the server. Preserve filters.
      examListRevisionRef.current += 1;
      setExams((current) => current.filter((exam) => exam.id !== target.id));
      setSelectedId((current) => current === target.id ? null : current);
      setMobilePanel("list");
      setDeletionNotice(`“${target.name}” was deleted successfully.`);
      deletionFocusRef.current = "list";
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      const detail = error instanceof ApiError ? error.detail : null;
      const code = error instanceof ApiError && error.status === 409 && detail && typeof detail === "object" && "code" in detail
        ? detail.code
        : null;
      let problem: ActionProblem;
      if (code === "PRACTICE_EXAM_HAS_ATTEMPTS") {
        setProtectedExams((current) => ({ ...current, [target.id]: true }));
        problem = { area: "delete", examId: target.id, title: "Exam cannot be deleted", message: "This exam has learner attempts. Keep it unpublished to protect existing answers and results." };
      } else if (code === "PRACTICE_EXAM_PUBLISHED") {
        problem = { area: "delete", examId: target.id, title: "Exam is published", message: "Refresh the exam list, then unpublish this exam before deleting it.", refreshList: true };
      } else if (code === "PRACTICE_EXAM_DELETE_CONFLICT") {
        problem = { area: "delete", examId: target.id, title: "Exam cannot be deleted", message: "This exam is linked to other records. Refresh the exam list and keep it unpublished if it has learner history.", refreshList: true };
      } else if (error instanceof ApiError && error.status === 404) {
        problem = { area: "delete", examId: target.id, title: "Exam not found", message: "It may have already been removed. Refresh the exam list to see the current records.", refreshList: true };
      } else if (error instanceof ApiError && error.status === 403) {
        problem = { area: "delete", examId: target.id, title: "Access denied", message: "Administrator access is required to delete practice exams." };
      } else {
        // A lost response does not establish whether the server committed the delete.
        problem = { area: "delete", examId: target.id, title: "Could not confirm deletion", message: "Check your connection and refresh the exam list before trying again. The current record has been kept in the list until its status can be verified.", refreshList: true };
      }
      setMobilePanel("details");
      setActionError(problem);
    } finally {
      deleteRequestRef.current = false;
      setPending(null);
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
        <ErrorNotice title="Could not load practice exams" message={loadError} />
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setReloadKey((current) => current + 1);
          }}
          className="mt-4 min-h-11 w-full rounded-md bg-[#343a3e] px-4 py-2 text-sm text-white sm:w-auto"
        >
          Retry loading exams
        </button>
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4 text-[#292d30] sm:space-y-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <PageHeader
          stepLabel="Exam management"
          title="Practice exams"
          subtitle="Configure exam availability. Only published exams can be started by learners."
        />
        <button
          type="button"
          onClick={(event) => {
            returnFocusRef.current = event.currentTarget;
            clearFormFeedback();
            setActionError(null);
            setSuccessMessage(null);
            setDeletionNotice("");
            setShowForm(true);
          }}
          disabled={controlsLocked}
          aria-expanded={showForm && !editingExam}
          aria-controls={showForm && !editingExam ? "create-practice-exam" : undefined}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#22282c] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto"
        >
          <Plus className="size-4" aria-hidden="true" />
          New exam
        </button>
      </div>

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
          {editingExam && (
            <p className="mt-3 text-sm font-semibold [overflow-wrap:anywhere]">Editing: {editingExam.name}</p>
          )}
          {(hasFieldErrors || formError) && (
            <div ref={formFeedbackRef} tabIndex={-1} className="mt-4 scroll-mt-24 outline-offset-2 focus-visible:outline-2">
              {hasFieldErrors ? (
                <ErrorNotice title="Check the highlighted fields" message="Correct the indicated fields before saving." />
              ) : (
                <ErrorNotice title={editingExam ? "Could not save changes" : "Could not create exam"} message={formError} />
              )}
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor="exam-name" className="block text-sm font-semibold">Exam name</label>
              <input
                id="exam-name"
                ref={nameInputRef}
                disabled={saving || countOnly}
                type="text"
                maxLength={255}
                required
                value={name}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                aria-describedby={fieldErrors.name ? "exam-name-error" : undefined}
                onChange={(event) => { setName(event.target.value); clearFieldError("name"); }}
                placeholder="Science practice"
                className={fieldClass(Boolean(fieldErrors.name))}
              />
              <FieldError id="exam-name-error" message={fieldErrors.name} />
            </div>
            <div className="min-w-0">
              <label htmlFor="exam-certification" className="block text-sm font-semibold">Certification</label>
              <select
                id="exam-certification"
                ref={certificationInputRef}
                aria-invalid={Boolean(fieldErrors.certification) || undefined}
                aria-describedby={fieldErrors.certification ? "exam-certification-error" : undefined}
                disabled={saving || countOnly}
                value={certificationId}
                onChange={(event) => {
                  setCertificationId(event.target.value);
                  setCategoryId("");
                  clearFieldError("certification", "category");
                }}
                required
                className={fieldClass(Boolean(fieldErrors.certification))}
              >
                <option value="">Select a certification</option>
                {certifications.map((certification) => (
                  <option key={certification.id} value={certification.id}>{certification.name}</option>
                ))}
              </select>
              <FieldError id="exam-certification-error" message={fieldErrors.certification} />
            </div>
            <div className="min-w-0">
              <label htmlFor="exam-category" className="block text-sm font-semibold">Category</label>
              <select
                id="exam-category"
                ref={categoryInputRef}
                value={categoryId}
                aria-invalid={Boolean(fieldErrors.category) || undefined}
                aria-describedby={fieldErrors.category ? "exam-category-error exam-category-help" : "exam-category-help"}
                onChange={(event) => { setCategoryId(event.target.value); clearFieldError("category"); }}
                required
                disabled={saving || countOnly || !certificationId || matchingCategories.length === 0}
                className={fieldClass(Boolean(fieldErrors.category))}
              >
                <option value="">Select a category</option>
                {matchingCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              <FieldError id="exam-category-error" message={fieldErrors.category} />
              <p id="exam-category-help" className="mt-1 text-sm text-[#687178]">
                {!certificationId ? "Choose a certification first." : matchingCategories.length === 0 && !countOnly ? "Create a category under Catalog first." : "Categories belong to the selected certification."}
              </p>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor="exam-question-count" className="block text-sm font-semibold">Question count (1–100)</label>
              <input
                id="exam-question-count"
                ref={countInputRef}
                disabled={saving}
                aria-invalid={Boolean(countError) || undefined}
                aria-describedby={countError ? "exam-count-error exam-count-help exam-count-availability" : "exam-count-help exam-count-availability"}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                required
                value={questionCount}
                onChange={(event) => {
                  setQuestionCount(event.target.value);
                  clearFieldError("questionCount");
                }}
                className={`${fieldClass(Boolean(countError))} sm:max-w-xs`}
              />
              <FieldError id="exam-count-error" message={countError} />
              <p id="exam-count-help" className="mt-1 text-sm text-[#687178]">Enter a whole number from 1 to 100. Changes apply to future attempts only.</p>
              <div id="exam-count-availability" aria-live="polite" className="mt-3 space-y-2 text-sm">
                {availableQuestionCount !== null ? (
                  <>
                    <p className="text-[#414b52]">
                      Last checked: <strong>{availableQuestionCount} eligible published questions</strong> in this category.
                    </p>
                    {exceedsAvailableQuestions && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold">Not enough eligible questions</p>
                          <p>Requested {Number(questionCount)}; available {availableQuestionCount}. Add {Number(questionCount) - availableQuestionCount} eligible questions or reduce the count.</p>
                          <p>You can save this configuration, but publishing requires enough eligible questions.</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[#687178]">Question availability will be checked after you save.</p>
                )}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2 border-t border-[#d9dde0] pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => closeForm()}
              disabled={saving}
              className="min-h-11 rounded-md border border-[#cbd0d3] px-4 py-2 text-sm font-semibold hover:bg-[#f2f3f4]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy}
              className="min-h-11 rounded-md bg-[#343a3e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#22282c] disabled:opacity-50"
            >
              {saving ? (editingExam ? "Saving..." : "Creating...") : editingExam ? "Save changes" : "Create draft"}
            </button>
          </div>
        </form>
      )}

      <div className={`${showForm ? "hidden xl:grid" : "grid"} min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)]`}>
        <section aria-labelledby="exam-list-heading" className={`${mobilePanel === "details" ? "hidden xl:block" : "block"} min-w-0 rounded-md border border-[#cfd2d5] bg-white p-3 sm:p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 ref={listHeadingRef} tabIndex={-1} id="exam-list-heading" className="min-w-0 scroll-mt-24 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">All practice exams</h2>
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
          {deletionNotice && (
            <div role="status" className="mt-3 flex items-start gap-2 rounded-md border border-[#b8cbbd] bg-[#edf4ee] p-3 text-sm text-[#35583a]">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <p className="min-w-0 [overflow-wrap:anywhere]">{deletionNotice}</p>
            </div>
          )}
          {actionError?.area === "list" && (
            <div ref={actionErrorRef} tabIndex={-1} className="mt-3 scroll-mt-24 outline-offset-2 focus-visible:outline-2">
              <ErrorNotice title={actionError.title} message={actionError.message} />
            </div>
          )}
          <label htmlFor="exam-search" className="sr-only">Search practice exams</label>
          <input
            id="exam-search"
            disabled={controlsLocked}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search exams, certifications, categories"
            className="mt-4 min-h-11 w-full min-w-0 rounded-md border border-[#cbd0d3] px-3 py-2 text-base sm:text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {(["all", "draft", "published", "unpublished"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                disabled={controlsLocked}
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
                className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
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
                    onClick={() => selectExam(exam.id)}
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
                      <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{exam.name}</span>
                      <span className="block text-xs text-[#687178] [overflow-wrap:anywhere]">{exam.certification_name} · {exam.category_name}</span>
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

        <section aria-labelledby="exam-details-heading" className={`${mobilePanel === "list" ? "hidden xl:block" : "block"} min-w-0 rounded-md border border-[#cfd2d5] bg-white p-3 sm:p-5`}>
          <button
            type="button"
            onClick={backToList}
            disabled={controlsLocked}
            className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-[#cbd0d3] px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 xl:hidden"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" /> Back to exam list
          </button>
          {selectedExam ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 ref={detailsHeadingRef} tabIndex={-1} id="exam-details-heading" className="scroll-mt-24 text-xl font-semibold [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2">{selectedExam.name}</h2>
                  <p className="mt-1 text-xs text-[#687178]">Exam details and publication readiness</p>
                </div>
                <span className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusStyle(selectedExam.status)}`}>
                  {statusLabel(selectedExam.status)}
                </span>
              </div>

              {successMessage?.examId === selectedExam.id && (
                <div role="status" className="flex items-start gap-2 rounded-md border border-[#b8cbbd] bg-[#edf4ee] p-3 text-sm text-[#35583a]">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 [overflow-wrap:anywhere]">{successMessage.message}</div>
                </div>
              )}

              <div className="rounded-md border border-[#d9dde0] bg-[#f6f7f8] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Configuration</h3>
                  {selectedExam.status !== "published" && (
                    <button
                      type="button"
                      disabled={controlsLocked}
                      onClick={(event) => openEdit(selectedExam, event.currentTarget)}
                      className="min-h-11 w-full rounded-md border border-[#cbd0d3] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#f2f3f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto"
                    >
                      Edit exam
                    </button>
                  )}
                </div>
                {selectedExam.status === "published" && (
                  <p className="mb-3 text-xs text-[#687178]">Unpublish the exam before editing its question count.</p>
                )}
                <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3">
                  <dt className="text-[#687178]">Certification</dt>
                  <dd className="mb-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:mb-0 sm:text-right">{selectedExam.certification_name}</dd>
                  <dt className="text-[#687178]">Category</dt>
                  <dd className="mb-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:mb-0 sm:text-right">{selectedExam.category_name}</dd>
                  <dt className="text-[#687178]">Question count</dt>
                  <dd className="mb-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:mb-0 sm:text-right">{selectedExam.question_count ?? "Not configured"}</dd>
                  <dt className="text-[#687178]">Passing threshold</dt>
                  <dd className="mb-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:mb-0 sm:text-right">
                    {selectedCertification?.passing_threshold_pct === null ||
                    selectedCertification?.passing_threshold_pct === undefined
                      ? "Not configured"
                      : `${selectedCertification.passing_threshold_pct}%`}
                  </dd>
                  <dt className="text-[#687178]">Eligible published questions</dt>
                  <dd className="mb-2 min-w-0 font-medium [overflow-wrap:anywhere] sm:mb-0 sm:text-right">{selectedExam.readiness.eligible_question_count}</dd>
                </dl>
              </div>

              <div className="rounded-md border border-[#d9dde0] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">Publication readiness</h3>
                  <button
                    type="button"
                    disabled={controlsLocked}
                    onClick={() => void refreshReadiness()}
                    className="min-h-11 rounded-md border border-[#cbd0d3] px-3 py-2 text-sm font-semibold text-[#414b52] hover:bg-[#f2f3f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
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

              {actionError?.area === "details" && (
                <div ref={actionErrorRef} tabIndex={-1} className="scroll-mt-24 outline-offset-2 focus-visible:outline-2">
                  <ErrorNotice title={actionError.title} message={actionError.message} />
                </div>
              )}

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

              <section aria-labelledby="exam-delete-heading" className="min-w-0 space-y-3 border-t border-[#d9dde0] pt-5">
                <h3 id="exam-delete-heading" className="text-sm font-semibold text-[#292d30]">Delete practice exam</h3>
                <p id="exam-delete-help" className="text-sm leading-5 text-[#687178]">
                  {selectedExamProtected
                    ? "Learner history is protected. Keep this exam unpublished instead of deleting it."
                    : selectedExam.status === "published"
                      ? "Unpublish this exam before deleting it."
                      : "Permanently remove this exam configuration. Exams with existing learner attempts cannot be deleted."}
                </p>
                {selectedExamProtected && (
                  <p className="flex items-start gap-2 rounded-md border border-[#d9dde0] bg-[#f6f7f8] p-3 text-sm font-medium text-[#414b52]">
                    <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>Protected learner history</span>
                  </p>
                )}
                {actionError?.area === "delete" && actionError.examId === selectedExam.id && (
                  <div ref={actionErrorRef} tabIndex={-1} className="space-y-2 scroll-mt-24 outline-offset-2 focus-visible:outline-2">
                    <ErrorNotice title={actionError.title} message={actionError.message} />
                    {actionError.refreshList && (
                      <button type="button" disabled={controlsLocked} onClick={refreshAfterDeletionIssue} className="min-h-11 w-full rounded-md border border-[#cbd0d3] px-4 py-2 text-sm font-semibold text-[#414b52] hover:bg-[#f2f3f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto">
                        Refresh exams
                      </button>
                    )}
                  </div>
                )}
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  aria-describedby="exam-delete-help"
                  disabled={controlsLocked || selectedExam.status === "published" || selectedExamProtected || (actionError?.area === "delete" && actionError.examId === selectedExam.id && actionError.refreshList)}
                  onClick={() => requestDeletion(selectedExam)}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  <Trash2 className="size-4 shrink-0" aria-hidden="true" /> Delete exam
                </button>
              </section>
            </div>
          ) : (
            <div>
              <h2 ref={detailsHeadingRef} tabIndex={-1} id="exam-details-heading" className="scroll-mt-24 text-lg font-semibold">Exam details</h2>
              <p className="mt-3 text-sm text-[#687178]">Select an exam to inspect its configuration and readiness.</p>
            </div>
          )}
        </section>
      </div>

      {pending && pendingExam && (
        <ExamActionConfirmation
          exam={pendingExam}
          action={pending.action}
          busy={changing}
          onCancel={cancelAction}
          onConfirm={() => void (pending.action === "delete" ? confirmDeletion() : confirmPublication())}
        />
      )}
    </section>
  );
}
