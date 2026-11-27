"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  DragEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import ImportCatalogResolution from "@/features/questions/ImportCatalogResolution";
import {
  confirmImportCatalog,
  type ImportCatalogConfirmation,
} from "@/lib/question-import-catalog-api";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  cancelQuestionImport,
  commitQuestionImport,
  getQuestionImport,
  getQuestionImportHistory,
  getQuestionImportRows,
  publishQuestionImport,
  revalidateQuestionImport,
  uploadQuestionImport,
  uploadQuestionImportAsset,
} from "@/lib/question-import-api";

import type {
  QuestionImportBatch,
  QuestionImportBatchStatus,
  QuestionImportCommitResponse,
  QuestionImportHistoryItem,
  QuestionImportIssue,
  QuestionImportPublishResponse,
  QuestionImportRow,
  QuestionImportRowStatus,
} from "@/types/question-import-api.types";


type Step =
  | "select"
  | "preview"
  | "complete";

type RowFilter =
  | "all"
  | "valid"
  | "invalid";

type ConfirmationAction =
  | "cancel"
  | "replace"
  | null;

interface IssueGroup {
  key: string;
  code: string;
  message: string;
  valuePreview: string | null;
  count: number;
  rowNumbers: number[];
}

interface ImportDiagnostics {
  missingImageNames: string[];
  issueGroups: IssueGroup[];
}

const pageSize = 50;


function errorMessage(
  error: unknown,
) {
  if (
    error instanceof ApiError
  ) {
    if (
      error.detail &&
      typeof error.detail ===
        "object" &&
      "message" in
        error.detail &&
      typeof (
        error.detail as {
          message?: unknown;
        }
      ).message === "string"
    ) {
      return (
        error.detail as {
          message: string;
        }
      ).message;
    }

    return error.message;
  }

  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return "Something went wrong.";
}


function isXlsxFile(
  file: File,
) {
  return file.name
    .toLowerCase()
    .endsWith(
      ".xlsx",
    );
}


function typeLabel(
  value: string | null,
) {
  if (
    value ===
    "multiple_choice"
  ) {
    return "Multiple Choice";
  }

  if (
    value ===
    "short_answer"
  ) {
    return "Short Answer";
  }

  return "—";
}


function rowStatusLabel(
  status: QuestionImportRowStatus,
) {
  if (
    status === "valid"
  ) {
    return "Ready";
  }

  if (
    status === "invalid"
  ) {
    return "Needs Attention";
  }

  if (
    status === "imported"
  ) {
    return "Imported";
  }

  if (
    status === "failed"
  ) {
    return "Failed";
  }

  return "Pending";
}


function rowStatusClasses(
  status: QuestionImportRowStatus,
) {
  if (
    status === "valid" ||
    status === "imported"
  ) {
    return (
      "bg-green-50 text-green-800 " +
      "border border-green-200"
    );
  }

  if (
    status === "invalid" ||
    status === "failed"
  ) {
    return (
      "bg-red-50 text-red-800 " +
      "border border-red-200"
    );
  }

  return (
    "bg-gray-100 text-gray-700 " +
    "border border-gray-200"
  );
}


function importStatusLabel(
  status: QuestionImportBatchStatus,
) {
  if (status === "imported") {
    return "Imported";
  }

  if (status === "ready") {
    return "Ready to Import";
  }

  if (status === "invalid") {
    return "Needs Attention";
  }

  if (status === "validating") {
    return "Validating";
  }

  if (status === "importing") {
    return "Importing";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return "Uploaded";
}


function importStatusClasses(
  status: QuestionImportBatchStatus,
) {
  if (status === "imported") {
    return (
      "border-green-200 bg-green-50 " +
      "text-green-800"
    );
  }

  if (status === "ready") {
    return (
      "border-blue-200 bg-blue-50 " +
      "text-blue-800"
    );
  }

  if (
    status === "invalid" ||
    status === "failed"
  ) {
    return (
      "border-red-200 bg-red-50 " +
      "text-red-800"
    );
  }

  if (
    status === "cancelled"
  ) {
    return (
      "border-gray-300 bg-gray-100 " +
      "text-gray-700"
    );
  }

  return (
    "border-gray-200 bg-gray-50 " +
    "text-gray-700"
  );
}


function importActionLabel(
  status: QuestionImportBatchStatus,
) {
  if (status === "ready") {
    return "Continue";
  }

  if (status === "invalid") {
    return "Review";
  }

  return "View";
}


function formatImportDate(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unknown date";
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


function groupIssues(
  rows: QuestionImportRow[],
): IssueGroup[] {
  const groups =
    new Map<string, IssueGroup>();

  for (const row of rows) {
    for (const issue of row.issues) {
      if (
        issue.severity !==
        "error"
      ) {
        continue;
      }

      const key = [
        issue.code,
        issue.message,
        issue.value_preview ?? "",
      ].join("|");

      const existing =
        groups.get(key);

      if (existing) {
        existing.count += 1;

        if (
          !existing.rowNumbers.includes(
            row.row_number,
          )
        ) {
          existing.rowNumbers.push(
            row.row_number,
          );
        }

        continue;
      }

      groups.set(
        key,
        {
          key,
          code:
            issue.code,
          message:
            issue.message,
          valuePreview:
            issue.value_preview,
          count:
            1,
          rowNumbers: [
            row.row_number,
          ],
        },
      );
    }
  }

  return Array.from(
    groups.values(),
  ).sort(
    (left, right) =>
      right.count -
      left.count,
  );
}


async function collectDiagnostics(
  token: string,
  batchId: string,
): Promise<ImportDiagnostics> {
  const invalidRows:
    QuestionImportRow[] = [];

  let page = 1;
  let total = 0;

  do {
    const response =
      await getQuestionImportRows(
        token,
        batchId,
        {
          row_status:
            "invalid",
          page,
          page_size:
            100,
        },
      );

    invalidRows.push(
      ...response.items,
    );

    total =
      response.total;
    page += 1;
  } while (
    (page - 1) * 100 <
    total
  );

  const imageNames =
    new Set<string>();

  for (
    const row
    of invalidRows
  ) {
    for (
      const issue
      of row.issues
    ) {
      if (
        issue.code ===
          "MISSING_IMAGE_FILE" &&
        issue.asset_filename
      ) {
        imageNames.add(
          issue.asset_filename,
        );
      }
    }
  }

  return {
    missingImageNames:
      Array.from(
        imageNames,
      ).sort(
        (left, right) =>
          left.localeCompare(
            right,
          ),
      ),
    issueGroups:
      groupIssues(
        invalidRows,
      ),
  };
}


function isRecoverableStatus(
  status: QuestionImportBatchStatus,
) {
  return [
    "uploaded",
    "invalid",
    "ready",
    "failed",
  ].includes(status);
}


export default function QuestionImportPage() {
  const {
    token,
    role,
    ready,
    handleError,
  } =
    useDemoSession();

  const [
    step,
    setStep,
  ] =
    useState<Step>(
      "select",
    );

  const [
    workbookFile,
    setWorkbookFile,
  ] =
    useState<File | null>(
      null,
    );

  const [
    batch,
    setBatch,
  ] =
    useState<QuestionImportBatch | null>(
      null,
    );

  const [
    rows,
    setRows,
  ] =
    useState<QuestionImportRow[]>(
      [],
    );

  const [
    rowsTotal,
    setRowsTotal,
  ] =
    useState(0);

  const [
    rowFilter,
    setRowFilter,
  ] =
    useState<RowFilter>(
      "all",
    );

  const [
    page,
    setPage,
  ] =
    useState(1);

  const [
    missingImages,
    setMissingImages,
  ] =
    useState<string[]>(
      [],
    );

  const [
    issueGroups,
    setIssueGroups,
  ] =
    useState<IssueGroup[]>(
      [],
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    notice,
    setNotice,
  ] =
    useState("");

  const [
    commitResult,
    setCommitResult,
  ] =
    useState<QuestionImportCommitResponse | null>(
      null,
    );

  const [
    publishResult,
    setPublishResult,
  ] =
    useState<QuestionImportPublishResponse | null>(
      null,
    );

  const [
    history,
    setHistory,
  ] =
    useState<QuestionImportHistoryItem[]>(
      [],
    );

  const [
    historyLoading,
    setHistoryLoading,
  ] =
    useState(true);

  const [
    historyError,
    setHistoryError,
  ] =
    useState("");

  const [
    historyReloadKey,
    setHistoryReloadKey,
  ] =
    useState(0);

  const [
    confirmationAction,
    setConfirmationAction,
  ] =
    useState<ConfirmationAction>(
      null,
    );

  const [
    replacementFile,
    setReplacementFile,
  ] =
    useState<File | null>(
      null,
    );

  const [
    publishConfirmationOpen,
    setPublishConfirmationOpen,
  ] =
    useState(false);

  useEffect(() => {
    if (
      !ready ||
      !token
    ) {
      return;
    }

    let cancelled = false;

    getQuestionImportHistory(
      token,
      {
        page: 1,
        page_size: 8,
      },
    )
      .then(
        (response) => {
          if (cancelled) {
            return;
          }

          setHistory(
            response.items,
          );
          setHistoryError("");
          setHistoryLoading(
            false,
          );
        },
      )
      .catch(
        (
          caught: unknown,
        ) => {
          if (cancelled) {
            return;
          }

          if (
            caught instanceof
              ApiError &&
            caught.status === 401
          ) {
            handleError(
              caught,
            );
            return;
          }

          setHistoryError(
            errorMessage(
              caught,
            ),
          );
          setHistoryLoading(
            false,
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    token,
    historyReloadKey,
    handleError,
  ]);

  const catalogNoticeRef = useRef<HTMLDivElement>(null);
  const catalogFocusRef = useRef(false);
  useEffect(() => {
    if (notice && catalogFocusRef.current) {
      catalogFocusRef.current = false;
      catalogNoticeRef.current?.focus();
    }
  }, [notice]);

  const pageCount =
    Math.max(
      1,
      Math.ceil(
        rowsTotal /
          pageSize,
      ),
    );

  const visibleErrorCount =
    useMemo(
      () =>
        rows.reduce(
          (
            count,
            row,
          ) =>
            count +
            row.issues.filter(
              (issue) =>
                issue.severity ===
                "error",
            ).length,
          0,
        ),
      [rows],
    );

  const canRecover =
    batch !== null &&
    isRecoverableStatus(
      batch.status,
    );

  async function loadRows(
    batchId: string,
    nextFilter: RowFilter,
    nextPage: number,
  ) {
    if (!token) {
      return;
    }

    const response =
      await getQuestionImportRows(
        token,
        batchId,
        {
          row_status:
            nextFilter ===
              "all"
              ? undefined
              : nextFilter,
          page:
            nextPage,
          page_size:
            pageSize,
        },
      );

    setRows(
      response.items,
    );
    setRowsTotal(
      response.total,
    );
    setRowFilter(
      nextFilter,
    );
    setPage(
      nextPage,
    );
  }

  async function refreshDiagnostics(
    batchId: string,
  ) {
    if (!token) {
      return;
    }

    const diagnostics =
      await collectDiagnostics(
        token,
        batchId,
      );

    setMissingImages(
      diagnostics
        .missingImageNames,
    );
    setIssueGroups(
      diagnostics.issueGroups,
    );
  }

  async function loadPreview(
    nextBatch: QuestionImportBatch,
    nextFilter: RowFilter = "all",
    nextPage: number = 1,
  ) {
    await Promise.all([
      loadRows(
        nextBatch.id,
        nextFilter,
        nextPage,
      ),
      refreshDiagnostics(
        nextBatch.id,
      ),
    ]);
  }

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function retryHistory() {
    setHistoryError("");
    setHistoryLoading(
      true,
    );
    setHistoryReloadKey(
      (value) =>
        value + 1,
    );
  }

  function chooseWorkbook(
    file: File | null,
  ) {
    clearMessages();

    if (!file) {
      setWorkbookFile(
        null,
      );
      return;
    }

    if (!isXlsxFile(file)) {
      setWorkbookFile(
        null,
      );
      setError(
        "Choose the approved .xlsx question-bank template.",
      );
      return;
    }

    setWorkbookFile(
      file,
    );
  }

  async function openHistoryImport(
    item: QuestionImportHistoryItem,
  ) {
    if (!token) {
      return;
    }

    setBusy(true);
    clearMessages();
    setCommitResult(
      null,
    );
    setPublishResult(
      null,
    );

    try {
      const refreshed =
        await getQuestionImport(
          token,
          item.id,
        );

      setBatch(
        refreshed,
      );
      setStep(
        "preview",
      );

      await loadPreview(
        refreshed,
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function validateWorkbook() {
    if (
      !token ||
      !workbookFile
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const uploaded =
        await uploadQuestionImport(
          token,
          workbookFile,
        );

      setBatch(
        uploaded,
      );
      setStep(
        "preview",
      );

      await loadPreview(
        uploaded,
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function addImageFiles(
    files: File[],
  ) {
    if (
      !token ||
      !batch ||
      busy ||
      files.length === 0
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      let latestBatch =
        batch;

      for (
        const file
        of files
      ) {
        const response =
          await uploadQuestionImportAsset(
            token,
            batch.id,
            file,
          );

        latestBatch =
          response.batch;
      }

      const refreshed =
        await getQuestionImport(
          token,
          latestBatch.id,
        );

      setBatch({ ...refreshed, can_import: false });

      await loadPreview(
        refreshed,
        rowFilter,
        1,
      );
      setBatch(refreshed);

      setNotice(
        "Images uploaded and validation refreshed.",
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revalidateCurrentImport() {
    if (
      !token ||
      !batch ||
      !canRecover
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const refreshed =
        await revalidateQuestionImport(
          token,
          batch.id,
        );

      setBatch({ ...refreshed, can_import: false });

      await loadPreview(
        refreshed,
        rowFilter,
        1,
      );
      setBatch(refreshed);

      setNotice(
        refreshed.can_import
          ? "Validation refreshed. This import is ready."
          : "Validation refreshed. Some issues still need attention.",
      );

      setHistoryReloadKey(
        (value) =>
          value + 1,
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  // JHEP-207: explicitly confirm missing catalog records before importing.
  async function confirmCatalogRecords(payload: ImportCatalogConfirmation) {
    if (!token || !batch || busy || role !== "administrator" || batch.status !== "invalid") {
      throw new ApiError(409, "The import is not available for catalog confirmation.");
    }
    setBusy(true);
    clearMessages();
    try {
      const result = await confirmImportCatalog(token, batch.id, payload);
      if (result.batch.id !== batch.id) throw new Error("Unexpected catalog confirmation response");

      // The server has committed the catalog changes. Do not report a failed
      // creation if only the subsequent preview refresh fails.
      setBatch({ ...result.batch, can_import: false });
      setRows([]);
      setRowsTotal(0);
      setMissingImages([]);
      setIssueGroups([]);
      setHistoryReloadKey((value) => value + 1);
      const created = result.created_certification_ids.length + result.created_category_ids.length;
      const receipt = `Catalog records created: ${created}. All new records are unpublished.`;
      try {
        await loadPreview(result.batch, "all", 1);
        setBatch(result.batch);
        catalogFocusRef.current = true;
        setNotice(`${receipt} ${result.batch.can_import ? "Review the validated rows before importing questions." : "Resolve the remaining validation issues before importing questions."}`);
      } catch (caught: unknown) {
        setNotice(receipt);
        if (caught instanceof ApiError && caught.status === 401) handleError(caught);
        else setError("Catalog records were created, but the validation preview could not be refreshed. Revalidate before importing questions.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (
      !token ||
      !batch ||
      !batch.can_import ||
      busy
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const result =
        await commitQuestionImport(
          token,
          batch.id,
        );

      setCommitResult(
        result,
      );
      setPublishResult(
        null,
      );
      setBatch(
        result.batch,
      );
      setStep(
        "complete",
      );
      setHistoryReloadKey(
        (value) =>
          value + 1,
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function publishCurrentImport() {
    if (
      !token ||
      !batch ||
      batch.status !==
        "imported" ||
      role !==
        "administrator"
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      const result =
        await publishQuestionImport(
          token,
          batch.id,
        );

      setPublishResult(
        result,
      );
      setBatch(
        result.batch,
      );
      setPublishConfirmationOpen(
        false,
      );

      setNotice(
        result.published_count >
        0
          ? `${result.published_count} question${result.published_count === 1 ? "" : "s"} approved and published.`
          : `All ${result.already_published_count} question${result.already_published_count === 1 ? "" : "s"} were already approved and published.`,
      );

      setHistoryReloadKey(
        (value) =>
          value + 1,
      );
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
      setPublishConfirmationOpen(
        false,
      );
    } finally {
      setBusy(false);
    }
  }


  async function changeFilter(
    nextFilter: RowFilter,
  ) {
    if (!batch) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      await loadRows(
        batch.id,
        nextFilter,
        1,
      );
    } catch (
      caught: unknown
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePage(
    nextPage: number,
  ) {
    if (!batch) {
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      await loadRows(
        batch.id,
        rowFilter,
        nextPage,
      );
    } catch (
      caught: unknown
    ) {
      setError(
        errorMessage(
          caught,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleWorkbookInput(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    chooseWorkbook(
      event.target.files?.[0] ??
        null,
    );
  }

  function handleCorrectedWorkbookInput(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (busy) return;
    const file =
      event.target.files?.[0] ??
      null;

    event.target.value =
      "";

    if (!file) {
      return;
    }

    clearMessages();

    if (!isXlsxFile(file)) {
      setError(
        "Choose the approved .xlsx question-bank template.",
      );
      return;
    }

    setReplacementFile(
      file,
    );
    setConfirmationAction(
      "replace",
    );
  }

  function handleImageInput(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    void addImageFiles(
      Array.from(
        event.target.files ??
          [],
      ),
    );

    event.target.value =
      "";
  }

  function handleImageDrop(
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();

    void addImageFiles(
      Array.from(
        event.dataTransfer.files,
      ),
    );
  }

  function closeConfirmation() {
    setConfirmationAction(
      null,
    );
    setReplacementFile(
      null,
    );
  }

  async function performConfirmedAction() {
    if (
      !token ||
      !batch ||
      !confirmationAction
    ) {
      return;
    }

    setBusy(true);
    clearMessages();

    const selectedAction =
      confirmationAction;
    const selectedFile =
      replacementFile;

    try {
      if (
        selectedAction ===
        "cancel"
      ) {
        const result =
          await cancelQuestionImport(
            token,
            batch.id,
          );

        setBatch(
          result.batch,
        );
        setMissingImages(
          [],
        );
        setNotice(
          result.already_cancelled
            ? "This import was already cancelled."
            : "Import cancelled. No questions were created.",
        );
        setHistoryReloadKey(
          (value) =>
            value + 1,
        );
        closeConfirmation();
        return;
      }

      if (!selectedFile) {
        return;
      }

      let cancelledBatch =
        batch;

      if (
        batch.status !==
        "cancelled"
      ) {
        const cancelled =
          await cancelQuestionImport(
            token,
            batch.id,
          );

        cancelledBatch =
          cancelled.batch;
        setBatch(
          cancelledBatch,
        );
      }

      const uploaded =
        await uploadQuestionImport(
          token,
          selectedFile,
        );

      setWorkbookFile(
        selectedFile,
      );
      setBatch(
        uploaded,
      );
      setCommitResult(
        null,
      );
      setStep(
        "preview",
      );
      setRowFilter(
        "all",
      );
      setPage(1);

      await loadPreview(
        uploaded,
      );

      setNotice(
        "Corrected workbook uploaded and validated.",
      );
      setHistoryReloadKey(
        (value) =>
          value + 1,
      );
      closeConfirmation();
    } catch (
      caught: unknown
    ) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        handleError(
          caught,
        );
        return;
      }

      setError(
        errorMessage(
          caught,
        ),
      );
      setConfirmationAction(
        null,
      );
      setReplacementFile(
        null,
      );
    } finally {
      setBusy(false);
    }
  }

  function resetImport() {
    setStep(
      "select",
    );
    setWorkbookFile(
      null,
    );
    setBatch(
      null,
    );
    setRows(
      [],
    );
    setRowsTotal(
      0,
    );
    setMissingImages(
      [],
    );
    setIssueGroups(
      [],
    );
    setCommitResult(
      null,
    );
    setPublishResult(
      null,
    );
    setPublishConfirmationOpen(
      false,
    );
    setError("");
    setNotice("");
    setRowFilter(
      "all",
    );
    setPage(1);
    closeConfirmation();
    setHistoryReloadKey(
      (value) =>
        value + 1,
    );
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
    <section className="min-w-0 wrap-anywhere">
      <div className="mb-5 min-w-0 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          stepLabel="Question Bank / Bulk Import"
          title="Import Questions"
          subtitle="Upload the approved Excel template, resolve any issues, then create the questions as pending Drafts."
        />

        <Link
          href="/admin/questions"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-5 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7]"
        >
          Back to Question Bank
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          ref={catalogNoticeRef}
          tabIndex={-1}
          role="status"
          className="mb-5 scroll-mt-24 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {notice}
        </div>
      )}

      {step ===
        "select" && (
        <>
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 rounded-md border border-[#d8dbde] bg-white p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-[#303438]">
                Upload question bank
              </h2>

              <p className="mt-2 text-sm text-[#666d72]">
                Use the approved Excel
                template. The file is
                validated before any
                questions are created.
              </p>

              <label className="mt-5 flex min-h-40 min-w-0 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#c7cbce] bg-[#fafafa] px-3 text-center hover:bg-[#f5f6f7] focus-within:outline-2 focus-within:outline-offset-2 sm:px-6">
                <FileSpreadsheet
                  aria-hidden="true"
                  className="mb-3 size-8 text-[#62686d]"
                />

                <span className="font-medium">
                  Choose Excel file
                </span>

                <span className="mt-1 text-xs text-[#737a80]">
                  .xlsx · up to 5 MiB ·
                  up to 1,000 questions
                </span>

                <input
                  aria-label="Question bank workbook"
                  disabled={busy}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={
                    handleWorkbookInput
                  }
                />
              </label>

              {workbookFile && (
                <div className="mt-4 flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#d8dbde] bg-[#f7f8f8] p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {
                        workbookFile.name
                      }
                    </p>

                    <p className="text-xs text-[#737a80]">
                      {Math.ceil(
                        workbookFile.size /
                          1024,
                      )}{" "}
                      KiB
                    </p>
                  </div>

                  <CheckCircle2
                    aria-label="Workbook selected"
                    className="size-5 shrink-0 text-green-700"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={
                  validateWorkbook
                }
                disabled={
                  !workbookFile ||
                  busy
                }
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#3d4145] px-4 text-sm font-semibold text-white hover:bg-[#292d30] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6"
              >
                {busy ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                ) : (
                  <Upload
                    aria-hidden="true"
                    className="size-4"
                  />
                )}

                Validate File
              </button>
            </div>

            <aside className="rounded-md border border-[#d8dbde] bg-[#f7f8f8] p-5">
              <h2 className="font-semibold">
                Need the template?
              </h2>

              <p className="mt-2 text-sm text-[#666d72]">
                Download the current
                workbook with examples,
                dropdowns and field
                guidance.
              </p>

              <a
                href="/templates/question-bank-import-template-v2.xlsx"
                download
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[#bfc4c7] bg-white px-4 py-2 text-center text-sm font-medium hover:bg-[#f1f2f3] sm:w-auto"
              >
                Download Excel Template
              </a>

              <div className="mt-6 border-t border-[#d8dbde] pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#737a80]">
                  What happens next
                </p>

                <ol className="mt-3 space-y-2 text-sm text-[#555c61]">
                  <li>
                    1. Validate every row.
                  </li>
                  <li>
                    2. Resolve catalog references and add images.
                  </li>
                  <li>
                    3. Review grouped issues.
                  </li>
                  <li>
                    4. Confirm the import.
                  </li>
                </ol>
              </div>
            </aside>
          </div>

          <RecentImports
            history={
              history
            }
            historyLoading={
              historyLoading
            }
            historyError={
              historyError
            }
            role={
              role
            }
            busy={
              busy
            }
            onRetry={
              retryHistory
            }
            onOpen={
              openHistoryImport
            }
          />
        </>
      )}

      {step ===
        "preview" &&
        batch && (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <SummaryCard
              label="Total"
              value={
                batch.total_rows
              }
            />
            <SummaryCard
              label="Ready"
              value={
                batch.valid_rows
              }
              tone="success"
            />
            <SummaryCard
              label="Errors"
              value={
                batch.error_rows
              }
              tone={
                batch.error_rows
                  ? "danger"
                  : "neutral"
              }
            />
            <SummaryCard
              label="Warnings"
              value={
                batch.warning_rows
              }
              tone="warning"
            />
          </div>

          {batch.status ===
            "cancelled" && (
            <div className="mt-5 rounded-md border border-gray-300 bg-gray-100 p-5">
              <div className="flex items-start gap-3">
                <Trash2
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-gray-700"
                />

                <div>
                  <h2 className="font-semibold">
                    Import cancelled
                  </h2>

                  <p className="mt-1 text-sm text-[#646b70]">
                    No questions were
                    created. The previous
                    validation remains
                    available as a
                    read-only audit record.
                  </p>
                </div>
              </div>
            </div>
          )}

          {batch.status === "invalid" && issueGroups.some((group) =>
            ["CERTIFICATION_NOT_FOUND", "CATEGORY_NOT_FOUND", "AMBIGUOUS_CATALOG_REFERENCE", "CATEGORY_CERTIFICATION_MISMATCH"].includes(group.code),
          ) && (
            <ImportCatalogResolution
              key={`${batch.id}:${batch.validated_at}:${role}`}
              batchId={batch.id}
              token={token}
              role={role}
              busy={busy}
              onConfirm={confirmCatalogRecords}
              onUnauthorized={handleError}
            />
          )}

          {issueGroups.length >
            0 && (
            <IssueSummary
              groups={
                issueGroups
              }
            />
          )}

          {missingImages.length >
            0 &&
            batch.status !==
              "cancelled" && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <ImagePlus
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-amber-800"
                />

                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-amber-950">
                    Add referenced images
                  </h2>

                  <p className="mt-1 text-sm text-amber-900">
                    The workbook references{" "}
                    {
                      missingImages.length
                    }{" "}
                    image
                    {missingImages.length ===
                    1
                      ? ""
                      : "s"}{" "}
                    that have not been
                    supplied.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {missingImages.map(
                      (
                        filename,
                      ) => (
                        <span
                          key={
                            filename
                          }
                          className="max-w-full wrap-anywhere rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium"
                        >
                          {
                            filename
                          }
                        </span>
                      ),
                    )}
                  </div>

                  <div
                    onDragOver={(
                      event,
                    ) =>
                      event.preventDefault()
                    }
                    onDrop={
                      handleImageDrop
                    }
                    className="mt-4 rounded-md border-2 border-dashed border-amber-300 bg-white p-5 text-center"
                  >
                    <p className="text-sm font-medium">
                      Drop PNG, JPEG or
                      WebP files here
                    </p>

                    <p className="mt-1 text-xs text-[#737a80]">
                      Filenames are matched
                      to the workbook
                      automatically.
                    </p>

                    <label className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-[#c7cbce] px-4 py-2 text-sm font-medium hover:bg-[#f6f7f7] focus-within:outline-2 focus-within:outline-offset-2 sm:w-auto">
                      Browse Images

                      <input
                        aria-label="Import images"
                        disabled={busy}
                        type="file"
                        multiple
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={
                          handleImageInput
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          <ValidationPreview
            batch={
              batch
            }
            rows={
              rows
            }
            rowsTotal={
              rowsTotal
            }
            rowFilter={
              rowFilter
            }
            page={
              page
            }
            pageCount={
              pageCount
            }
            visibleErrorCount={
              visibleErrorCount
            }
            busy={
              busy
            }
            onFilter={
              changeFilter
            }
            onPage={
              changePage
            }
          />

          <ImportActions
            batch={
              batch
            }
            role={
              role
            }
            publishResult={
              publishResult
            }
            busy={
              busy
            }
            canRecover={
              canRecover
            }
            onImport={
              confirmImport
            }
            onPublish={() =>
              setPublishConfirmationOpen(
                true,
              )
            }
            onRevalidate={
              revalidateCurrentImport
            }
            onCancel={() =>
              setConfirmationAction(
                "cancel",
              )
            }
            onCorrectedFile={
              handleCorrectedWorkbookInput
            }
            onReset={
              resetImport
            }
          />
        </>
      )}

      {step ===
        "complete" &&
        commitResult && (
        <div className="mx-auto max-w-2xl rounded-md border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto size-12 text-green-700"
          />

          <h2 className="mt-4 text-xl font-semibold">
            Import complete
          </h2>

          <p className="mt-2 text-sm text-[#526057]">
            {
              commitResult.created_count
            }{" "}
            question
            {commitResult.created_count ===
            1
              ? ""
              : "s"}{" "}
            are now visible in the
            Question Bank as pending
            Drafts.
          </p>

          {role ===
          "administrator" ? (
            publishResult?.all_published ? (
              <div
                role="status"
                className="mt-5 rounded-md border border-green-300 bg-white p-4 text-left"
              >
                <h3 className="font-semibold text-green-900">
                  Publication complete
                </h3>

                <p className="mt-1 text-sm text-green-800">
                  {
                    publishResult.published_count
                  }{" "}
                  question
                  {publishResult.published_count ===
                  1
                    ? ""
                    : "s"}{" "}
                  {publishResult.published_count ===
                  1
                    ? "was"
                    : "were"}{" "}
                  newly approved and published.
                </p>

                {publishResult.already_published_count >
                  0 && (
                  <p className="mt-1 text-sm text-green-800">
                    {
                      publishResult.already_published_count
                    }{" "}
                    question
                    {publishResult.already_published_count ===
                    1
                      ? ""
                      : "s"}{" "}
                    {publishResult.already_published_count ===
                    1
                      ? "was"
                      : "were"}{" "}
                    already published.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-md border border-blue-200 bg-blue-50 p-4 text-left">
                <h3 className="font-semibold text-blue-950">
                  Administrator review
                </h3>

                <p className="mt-1 text-sm text-blue-900">
                  Approve and publish every
                  eligible question created
                  by this import in one
                  atomic action.
                </p>

                <p className="mt-2 text-xs text-blue-800">
                  Certification and category
                  publication remain separate.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setPublishConfirmationOpen(
                      true,
                    )
                  }
                  disabled={
                    busy
                  }
                  className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-800 px-5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
                >
                  {busy && (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  )}

                  Approve & Publish All{" "}
                  {
                    commitResult.created_count
                  }
                </button>
              </div>
            )
          ) : (
            <div className="mt-5 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              The questions were submitted
              for Administrator review.
            </div>
          )}

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/admin/questions"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white"
            >
              View Question Bank
            </Link>

            <button
              type="button"
              onClick={
                resetImport
              }
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-6 text-sm font-semibold"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}

      {publishConfirmationOpen &&
        batch && (
        <PublishConfirmationDialog
          count={
            batch.imported_rows
          }
          busy={
            busy
          }
          onClose={() =>
            setPublishConfirmationOpen(
              false,
            )
          }
          onConfirm={
            publishCurrentImport
          }
        />
      )}

      {confirmationAction && (
        <ConfirmationDialog
          action={
            confirmationAction
          }
          file={
            replacementFile
          }
          busy={
            busy
          }
          onClose={
            closeConfirmation
          }
          onConfirm={
            performConfirmedAction
          }
        />
      )}
    </section>
  );
}


function RecentImports({
  history,
  historyLoading,
  historyError,
  role,
  busy,
  onRetry,
  onOpen,
}: {
  history: QuestionImportHistoryItem[];
  historyLoading: boolean;
  historyError: string;
  role: string | null;
  busy: boolean;
  onRetry: () => void;
  onOpen: (
    item: QuestionImportHistoryItem,
  ) => Promise<void>;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-md border border-[#d8dbde] bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-[#d8dbde] p-5">
        <div>
          <h2 className="font-semibold text-[#303438]">
            Recent Imports
          </h2>

          <p className="mt-1 text-sm text-[#6a7176]">
            Reopen a recent validation
            or review completed and
            cancelled imports.
          </p>
        </div>

        {historyError && (
          <button
            type="button"
            onClick={
              onRetry
            }
            className="text-sm font-medium underline underline-offset-4"
          >
            Retry
          </button>
        )}
      </div>

      {historyLoading ? (
        <div
          role="status"
          className="p-6 text-sm text-[#6a7176]"
        >
          Loading recent imports...
        </div>
      ) : historyError ? (
        <div
          role="alert"
          className="p-6 text-sm text-red-700"
        >
          {historyError}
        </div>
      ) : history.length ===
        0 ? (
        <div className="p-6 text-sm text-[#6a7176]">
          No imports yet. Your recent
          bulk uploads will appear here.
        </div>
      ) : (
        <div className="divide-y divide-[#e1e3e5]">
          {history.map(
            (item) => (
              <div
                key={
                  item.id
                }
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 wrap-anywhere font-medium">
                      {
                        item.original_filename
                      }
                    </p>

                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${importStatusClasses(
                        item.status,
                      )}`}
                    >
                      {importStatusLabel(
                        item.status,
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-[#666d72]">
                    {
                      item.total_rows
                    }{" "}
                    question
                    {item.total_rows ===
                    1
                      ? ""
                      : "s"}
                    {" · "}
                    {
                      item.error_rows
                    }{" "}
                    error
                    {item.error_rows ===
                    1
                      ? ""
                      : "s"}
                    {" · "}
                    {
                      item.warning_rows
                    }{" "}
                    warning
                    {item.warning_rows ===
                    1
                      ? ""
                      : "s"}
                  </p>

                  <p className="mt-1 text-xs text-[#7a8186]">
                    {formatImportDate(
                      item.created_at,
                    )}
                    {role ===
                    "administrator"
                      ? ` · ${item.uploaded_by_name || item.uploaded_by_email}`
                      : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void onOpen(
                      item,
                    )
                  }
                  disabled={
                    busy
                  }
                  className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-4 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7] disabled:opacity-50 sm:w-auto"
                >
                  {importActionLabel(
                    item.status,
                  )}
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}


function IssueSummary({
  groups,
}: {
  groups: IssueGroup[];
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-red-200 bg-white">
      <div className="border-b border-red-100 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 text-red-700"
          />

          <div>
            <h2 className="font-semibold text-red-950">
              Issues to resolve
            </h2>

            <p className="mt-1 text-sm text-red-800">
              Repeated row errors are
              grouped so you can correct
              the workbook efficiently.
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[#eceeef]">
        {groups.map(
          (group) => (
            <div
              key={
                group.key
              }
              className="p-5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-[#303438]">
                    {group.code}
                  </p>

                  <p className="mt-1 text-sm text-[#62696e]">
                    {
                      group.message
                    }
                  </p>

                  {group.valuePreview && (
                    <p className="mt-2 text-xs text-[#737a80]">
                      Value:{" "}
                      <code className="rounded bg-[#f2f3f4] px-1.5 py-0.5">
                        {
                          group.valuePreview
                        }
                      </code>
                    </p>
                  )}
                </div>

                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">
                  Affects{" "}
                  {group.count}{" "}
                  row
                  {group.count ===
                  1
                    ? ""
                    : "s"}
                </span>
              </div>

              <p className="mt-2 text-xs text-[#7a8186]">
                Rows:{" "}
                {group.rowNumbers
                  .slice(
                    0,
                    12,
                  )
                  .join(", ")}
                {group.rowNumbers.length >
                12
                  ? "…"
                  : ""}
              </p>
            </div>
          ),
        )}
      </div>
    </section>
  );
}


function ValidationPreview({
  batch,
  rows,
  rowsTotal,
  rowFilter,
  page,
  pageCount,
  visibleErrorCount,
  busy,
  onFilter,
  onPage,
}: {
  batch: QuestionImportBatch;
  rows: QuestionImportRow[];
  rowsTotal: number;
  rowFilter: RowFilter;
  page: number;
  pageCount: number;
  visibleErrorCount: number;
  busy: boolean;
  onFilter: (
    filter: RowFilter,
  ) => Promise<void>;
  onPage: (
    page: number,
  ) => Promise<void>;
}) {
  return (
    <div className="mt-5 min-w-0 rounded-md border border-[#d8dbde] bg-white">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[#d8dbde] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">
            Validation Preview
          </h2>

          <p className="mt-1 text-xs text-[#737a80]">
            {
              batch.original_filename
            }
            {" · "}
            Contract{" "}
            {
              batch.template_version
            }
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              "all",
              "valid",
              "invalid",
            ] as const
          ).map(
            (
              filter,
            ) => (
              <button
                key={
                  filter
                }
                type="button"
                onClick={() =>
                  void onFilter(
                    filter,
                  )
                }
                disabled={
                  busy
                }
                aria-pressed={rowFilter === filter}
                className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium ${
                  rowFilter ===
                  filter
                    ? "bg-[#3d4145] text-white"
                    : "border border-[#cfd2d5] bg-white text-[#4e555a]"
                }`}
              >
                {filter ===
                "all"
                  ? "All"
                  : filter ===
                      "valid"
                    ? "Ready"
                    : "Needs Attention"}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="min-w-0">
        <table role="table" aria-label="Validation rows" className="block w-full min-w-0 border-collapse text-left text-sm xl:table xl:table-fixed">
          <thead role="rowgroup" className="sr-only bg-[#f3f4f5] text-xs font-semibold uppercase tracking-wide text-[#656c72] xl:not-sr-only xl:table-header-group">
            <tr role="row">
              <th role="columnheader" scope="col" className="w-[7%] px-2 py-3">
                Row
              </th>
              <th role="columnheader" scope="col" className="w-[29%] px-3 py-3">
                Question
              </th>
              <th role="columnheader" scope="col" className="px-3 py-3">
                Certification
              </th>
              <th role="columnheader" scope="col" className="px-3 py-3">
                Category
              </th>
              <th role="columnheader" scope="col" className="px-3 py-3">
                Type
              </th>
              <th role="columnheader" scope="col" className="px-3 py-3">
                Image
              </th>
              <th role="columnheader" scope="col" className="px-3 py-3">
                Status
              </th>
            </tr>
          </thead>

          <tbody role="rowgroup" className="block xl:table-row-group">
            {rows.map(
              (row) => (
                <ImportRow
                  key={
                    row.id
                  }
                  row={
                    row
                  }
                />
              ),
            )}
          </tbody>
        </table>
      </div>

      {rows.length ===
        0 && (
        <div className="border-t border-[#d8dbde] p-8 text-center text-sm text-[#70777c]">
          No rows match this
          filter.
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-[#d8dbde] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>
          {rowsTotal} row
          {rowsTotal === 1
            ? ""
            : "s"}{" "}
          in this view
          {visibleErrorCount >
          0
            ? ` · ${visibleErrorCount} visible error${visibleErrorCount === 1 ? "" : "s"}`
            : ""}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous preview page"
            disabled={
              page === 1 ||
              busy
            }
            onClick={() =>
              void onPage(
                Math.max(
                  1,
                  page - 1,
                ),
              )
            }
            className="min-h-11 min-w-11 rounded border border-[#cfd2d5] px-3 py-1.5 disabled:opacity-40"
          >
            ‹
          </button>

          <span>
            {page} /{" "}
            {pageCount}
          </span>

          <button
            type="button"
            aria-label="Next preview page"
            disabled={
              page ===
                pageCount ||
              busy
            }
            onClick={() =>
              void onPage(
                Math.min(
                  pageCount,
                  page + 1,
                ),
              )
            }
            className="min-h-11 min-w-11 rounded border border-[#cfd2d5] px-3 py-1.5 disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}


function ImportActions({
  batch,
  role,
  publishResult,
  busy,
  canRecover,
  onImport,
  onPublish,
  onRevalidate,
  onCancel,
  onCorrectedFile,
  onReset,
}: {
  batch: QuestionImportBatch;
  role: string | null;
  publishResult:
    QuestionImportPublishResponse | null;
  busy: boolean;
  canRecover: boolean;
  onImport: () => Promise<void>;
  onPublish: () => void;
  onRevalidate: () => Promise<void>;
  onCancel: () => void;
  onCorrectedFile: (
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
  onReset: () => void;
}) {
  if (
    batch.status ===
    "imported"
  ) {
    return (
      <div className="mt-5 rounded-md border border-[#d8dbde] bg-white p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 text-green-700"
            />

            <div>
              <h2 className="font-semibold">
                Already imported
              </h2>

              <p className="mt-1 text-sm text-[#646b70]">
                This batch created{" "}
                {
                  batch.imported_rows
                }{" "}
                pending Draft question
                {batch.imported_rows ===
                1
                  ? ""
                  : "s"}.
              </p>
            </div>
          </div>

          {publishResult?.all_published && (
            <div
              role="status"
              className="rounded-md border border-green-200 bg-green-50 p-4"
            >
              <p className="font-semibold text-green-900">
                All imported questions are
                published.
              </p>

              <p className="mt-1 text-sm text-green-800">
                {
                  publishResult.published_count
                }{" "}
                newly published
                {publishResult.already_published_count >
                  0
                  ? ` · ${publishResult.already_published_count} already published`
                  : ""}
              </p>
            </div>
          )}

          {role ===
            "contributor" && (
            <p className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              The questions were submitted
              for Administrator review.
            </p>
          )}

          <p className="text-xs text-[#737a80]">
            Publishing questions does not
            publish the certification or
            categories.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/admin/questions"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-6 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7]"
            >
              View Question Bank
            </Link>

            {role ===
              "administrator" &&
              !publishResult?.all_published && (
              <button
                type="button"
                onClick={
                  onPublish
                }
                disabled={
                  busy
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-800 px-6 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
              >
                {busy && (
                  <Loader2
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                )}

                Approve & Publish All{" "}
                {
                  batch.imported_rows
                }
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (
    batch.status ===
    "cancelled"
  ) {
    return (
      <div className="mt-5 rounded-md border border-[#d8dbde] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">
              Cancelled import
            </h2>

            <p className="mt-1 text-sm text-[#646b70]">
              This record is read-only.
              Start a new import or upload
              the same workbook again.
            </p>
          </div>

          <button
            type="button"
            onClick={
              onReset
            }
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white"
          >
            Start New Import
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-md border border-[#d8dbde] bg-white p-5">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          {batch.can_import ? (
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 text-green-700"
            />
          ) : (
            <XCircle
              aria-hidden="true"
              className="mt-0.5 size-5 text-red-700"
            />
          )}

          <div>
            <h2 className="font-semibold">
              {batch.can_import
                ? "Ready to import"
                : batch.status === "ready" ? "Preview unavailable" : "Import blocked"}
            </h2>

            <p className="mt-1 text-sm text-[#646b70]">
              {batch.can_import
                ? `All ${batch.valid_rows} questions will be created as pending, unpublished Drafts.`
                : batch.status === "ready" ? "Refresh validation before importing questions." : `Fix all ${batch.error_rows} row${batch.error_rows === 1 ? "" : "s"} with errors before importing. No questions have been created.`}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#e1e3e5] pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#cfd2d5] bg-white px-4 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7] ${
              busy || !canRecover
                ? "pointer-events-none opacity-50"
                : ""
            }`}
          >
            <RotateCcw
              aria-hidden="true"
              className="size-4"
            />

            Upload Corrected File

            <input
              aria-label="Corrected question bank workbook"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={
                busy ||
                !canRecover
              }
              onChange={
                onCorrectedFile
              }
            />
          </label>

          <button
            type="button"
            onClick={() =>
              void onRevalidate()
            }
            disabled={
              busy ||
              !canRecover
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#cfd2d5] bg-white px-4 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7] disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${
                busy
                  ? "animate-spin"
                  : ""
              }`}
            />

            Revalidate
          </button>

          <button
            type="button"
            onClick={
              onCancel
            }
            disabled={
              busy ||
              !canRecover
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2
              aria-hidden="true"
              className="size-4"
            />

            Cancel Import
          </button>

          {batch.can_import && (
            <button
              type="button"
              onClick={() =>
                void onImport()
              }
              disabled={
                busy
              }
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white hover:bg-[#292d30] disabled:opacity-50 sm:ml-auto"
            >
              {busy && (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              )}

              Import{" "}
              {
                batch.valid_rows
              }{" "}
              Questions
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function PublishConfirmationDialog({
  count,
  busy,
  onClose,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget &&
          !busy
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-import-title"
        className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-lg overflow-y-auto overscroll-contain rounded-md border border-[#d8dbde] bg-white p-4 shadow-xl sm:p-6"
      >
        <h2
          id="publish-import-title"
          className="text-lg font-semibold"
        >
          Approve and publish{" "}
          {count}{" "}
          question
          {count ===
          1
            ? ""
            : "s"}?
        </h2>

        <p className="mt-3 text-sm leading-6 text-[#60676c]">
          Every eligible question created
          by this import will become
          Approved and Active. The whole
          batch is checked before any
          question is changed.
        </p>

        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          This does not publish the
          certification or categories.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              busy
            }
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-5 text-sm font-semibold disabled:opacity-50"
          >
            Keep as Drafts
          </button>

          <button
            type="button"
            onClick={() =>
              void onConfirm()
            }
            disabled={
              busy
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-800 px-5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
          >
            {busy && (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            )}

            Publish{" "}
            {count}{" "}
            Question
            {count ===
            1
              ? ""
              : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}


function ConfirmationDialog({
  action,
  file,
  busy,
  onClose,
  onConfirm,
}: {
  action: Exclude<
    ConfirmationAction,
    null
  >;
  file: File | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const replacing =
    action === "replace";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget &&
          !busy
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-confirmation-title"
        className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-lg overflow-y-auto overscroll-contain rounded-md border border-[#d8dbde] bg-white p-4 shadow-xl sm:p-6"
      >
        <h2
          id="import-confirmation-title"
          className="text-lg font-semibold"
        >
          {replacing
            ? "Replace this import?"
            : "Cancel this import?"}
        </h2>

        <p className="mt-3 text-sm leading-6 text-[#60676c]">
          {replacing
            ? "The current validation and any temporary images will be discarded before the corrected workbook is validated."
            : "No questions have been created. The validation results and any temporary images will be discarded."}
        </p>

        {replacing &&
          file && (
          <p className="mt-3 rounded-md bg-[#f4f5f6] p-3 text-sm font-medium">
            {
              file.name
            }
          </p>
        )}

        <p className="mt-3 text-sm font-medium text-[#3f4549]">
          This action cannot be undone.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              busy
            }
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-5 text-sm font-semibold disabled:opacity-50"
          >
            Keep Import
          </button>

          <button
            type="button"
            onClick={() =>
              void onConfirm()
            }
            disabled={
              busy
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busy && (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            )}

            {replacing
              ? "Replace and Validate"
              : "Cancel Import"}
          </button>
        </div>
      </div>
    </div>
  );
}


function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?:
    | "neutral"
    | "success"
    | "danger"
    | "warning";
}) {
  const classes = {
    neutral:
      "border-[#d8dbde] bg-white",
    success:
      "border-green-200 bg-green-50",
    danger:
      "border-red-200 bg-red-50",
    warning:
      "border-amber-200 bg-amber-50",
  }[tone];

  return (
    <div
      className={`min-w-0 rounded-md border p-3 sm:p-4 ${classes}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#737a80]">
        {label}
      </p>

      <p className="mt-1 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}


function ImportRow({
  row,
}: {
  row: QuestionImportRow;
}) {
  return (
    <>
      <tr role="row" className="grid min-w-0 gap-1 border-t border-[#e1e3e5] px-3 py-3 align-top xl:table-row xl:p-0">
        <td role="cell" data-label="Row" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none font-medium">
          {row.row_number}
        </td>

        <td role="cell" data-label="Question" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          {row.question_text ??
            "—"}
        </td>

        <td role="cell" data-label="Certification" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          {row.certification_code ??
            "—"}
        </td>

        <td role="cell" data-label="Category" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          {row.category_name ??
            "Uncategorized"}
        </td>

        <td role="cell" data-label="Type" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          {typeLabel(
            row.question_type,
          )}
        </td>

        <td role="cell" data-label="Image" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          {row.image_filename ??
            "—"}
        </td>

        <td role="cell" data-label="Status" className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-2 py-1 text-left wrap-anywhere before:text-xs before:font-semibold before:text-[#62696e] before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-4 xl:before:content-none">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${rowStatusClasses(
              row.status,
            )}`}
          >
            {rowStatusLabel(
              row.status,
            )}
          </span>
        </td>
      </tr>

      {row.issues.length >
        0 && (
        <tr role="row" className="block min-w-0 border-t border-[#eceeef] bg-[#fafafa] xl:table-row">
          <td
            role="cell"
            colSpan={7}
            className="block min-w-0 px-3 py-3 xl:table-cell xl:px-4"
          >
            <div className="space-y-2">
              {row.issues.map(
                (
                  issue,
                  index,
                ) => (
                  <RowIssue
                    key={`${issue.code}-${index}`}
                    issue={
                      issue
                    }
                  />
                ),
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}


function RowIssue({
  issue,
}: {
  issue: QuestionImportIssue;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {issue.severity ===
      "error" ? (
        <XCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-red-700"
        />
      ) : (
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-amber-700"
        />
      )}

      <p>
        <span className="font-medium">
          {issue.code}
        </span>
        {" — "}
        {issue.message}
      </p>
    </div>
  );
}
