"use client";

import Link from "next/link";
import {
  useMemo,
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
  Upload,
  XCircle,
} from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import {
  commitQuestionImport,
  getQuestionImport,
  getQuestionImportRows,
  uploadQuestionImport,
  uploadQuestionImportAsset,
} from "@/lib/question-import-api";
import { ApiError } from "@/lib/api-client";

import type {
  QuestionImportBatch,
  QuestionImportCommitResponse,
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

async function collectMissingImageNames(
  token: string,
  batchId: string,
) {
  const names =
    new Set<string>();

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

    total =
      response.total;

    for (
      const row
      of response.items
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
          names.add(
            issue.asset_filename,
          );
        }
      }
    }

    page += 1;
  } while (
    (page - 1) * 100 <
    total
  );

  return Array.from(
    names,
  ).sort((a, b) =>
    a.localeCompare(b),
  );
}

export default function QuestionImportPage() {
  const {
    token,
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
    commitResult,
    setCommitResult,
  ] =
    useState<QuestionImportCommitResponse | null>(
      null,
    );

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
          page: nextPage,
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

  async function refreshMissingImages(
    batchId: string,
  ) {
    if (!token) {
      return;
    }

    const filenames =
      await collectMissingImageNames(
        token,
        batchId,
      );

    setMissingImages(
      filenames,
    );
  }

  function chooseWorkbook(
    file: File | null,
  ) {
    setError("");

    if (!file) {
      setWorkbookFile(
        null,
      );
      return;
    }

    if (
      !file.name
        .toLowerCase()
        .endsWith(
          ".xlsx",
        )
    ) {
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

  async function validateWorkbook() {
    if (
      !token ||
      !workbookFile
    ) {
      return;
    }

    setBusy(true);
    setError("");

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

      await Promise.all([
        loadRows(
          uploaded.id,
          "all",
          1,
        ),
        refreshMissingImages(
          uploaded.id,
        ),
      ]);

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
      files.length === 0
    ) {
      return;
    }

    setBusy(true);
    setError("");

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

      setBatch(
        refreshed,
      );

      await Promise.all([
        loadRows(
          refreshed.id,
          rowFilter,
          1,
        ),
        refreshMissingImages(
          refreshed.id,
        ),
      ]);

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

  async function confirmImport() {
    if (
      !token ||
      !batch ||
      !batch.can_import
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result =
        await commitQuestionImport(
          token,
          batch.id,
        );

      setCommitResult(
        result,
      );
      setBatch(
        result.batch,
      );
      setStep(
        "complete",
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

  async function changeFilter(
    nextFilter: RowFilter,
  ) {
    if (!batch) {
      return;
    }

    setBusy(true);
    setError("");

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
    setError("");

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
    setCommitResult(
      null,
    );
    setError("");
    setRowFilter(
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
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          stepLabel="JHEP-118 / Bulk Import"
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

      {step ===
        "select" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-md border border-[#d8dbde] bg-white p-6">
            <h2 className="text-lg font-semibold text-[#303438]">
              Upload question bank
            </h2>

            <p className="mt-2 text-sm text-[#666d72]">
              Use the approved
              Excel template. The
              file is validated
              before any questions
              are created.
            </p>

            <label className="mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#c7cbce] bg-[#fafafa] px-6 text-center hover:bg-[#f5f6f7]">
              <FileSpreadsheet
                aria-hidden="true"
                className="mb-3 size-8 text-[#62686d]"
              />

              <span className="font-medium">
                Choose Excel file
              </span>

              <span className="mt-1 text-xs text-[#737a80]">
                .xlsx · up to 5 MiB
                · up to 1,000
                questions
              </span>

              <input
                aria-label="Question bank workbook"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={
                  handleWorkbookInput
                }
              />
            </label>

            {workbookFile && (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-[#d8dbde] bg-[#f7f8f8] p-4">
                <div>
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
                  className="size-5 text-green-700"
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
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white hover:bg-[#292d30] disabled:cursor-not-allowed disabled:opacity-50"
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
              workbook with
              examples, dropdowns
              and field guidance.
            </p>

            <a
              href="/templates/question-bank-import-template-v2.xlsx"
              download
              className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[#bfc4c7] bg-white px-4 text-sm font-medium hover:bg-[#f1f2f3]"
            >
              Download Excel Template
            </a>

            <div className="mt-6 border-t border-[#d8dbde] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#737a80]">
                What happens next
              </p>

              <ol className="mt-3 space-y-2 text-sm text-[#555c61]">
                <li>
                  1. Validate every
                  row.
                </li>
                <li>
                  2. Add referenced
                  images if needed.
                </li>
                <li>
                  3. Review errors
                  and warnings.
                </li>
                <li>
                  4. Confirm the
                  entire import.
                </li>
              </ol>
            </div>
          </aside>
        </div>
      )}

      {step ===
        "preview" &&
        batch && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

          {missingImages.length >
            0 && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <ImagePlus
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-amber-800"
                />

                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-amber-950">
                    Add referenced
                    images
                  </h2>

                  <p className="mt-1 text-sm text-amber-900">
                    The workbook
                    references{" "}
                    {
                      missingImages.length
                    }{" "}
                    image
                    {missingImages.length ===
                    1
                      ? ""
                      : "s"}{" "}
                    that have not
                    been supplied.
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
                          className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium"
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
                      Drop PNG,
                      JPEG or WebP
                      files here
                    </p>

                    <p className="mt-1 text-xs text-[#737a80]">
                      Filenames are
                      matched to the
                      workbook
                      automatically.
                    </p>

                    <label className="mt-3 inline-flex cursor-pointer rounded-md border border-[#c7cbce] px-4 py-2 text-sm font-medium hover:bg-[#f6f7f7]">
                      Browse Images
                      <input
                        aria-label="Import images"
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

          <div className="mt-5 rounded-md border border-[#d8dbde] bg-white">
            <div className="flex flex-col gap-3 border-b border-[#d8dbde] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">
                  Validation Preview
                </h2>
                <p className="mt-1 text-xs text-[#737a80]">
                  {batch.original_filename}
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
                        void changeFilter(
                          filter,
                        )
                      }
                      disabled={
                        busy
                      }
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
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

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-[#f3f4f5] text-xs font-semibold uppercase tracking-wide text-[#656c72]">
                  <tr>
                    <th className="px-4 py-3">
                      Row
                    </th>
                    <th className="px-4 py-3">
                      Question
                    </th>
                    <th className="px-4 py-3">
                      Certification
                    </th>
                    <th className="px-4 py-3">
                      Category
                    </th>
                    <th className="px-4 py-3">
                      Type
                    </th>
                    <th className="px-4 py-3">
                      Image
                    </th>
                    <th className="px-4 py-3">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
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
                    void changePage(
                      Math.max(
                        1,
                        page - 1,
                      ),
                    )
                  }
                  className="rounded border border-[#cfd2d5] px-3 py-1.5 disabled:opacity-40"
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
                    void changePage(
                      Math.min(
                        pageCount,
                        page + 1,
                      ),
                    )
                  }
                  className="rounded border border-[#cfd2d5] px-3 py-1.5 disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-md border border-[#d8dbde] bg-white p-5">
            {batch.can_import ? (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-5 text-green-700"
                  />

                  <div>
                    <h2 className="font-semibold">
                      Ready to import
                    </h2>
                    <p className="mt-1 text-sm text-[#646b70]">
                      All{" "}
                      {
                        batch.valid_rows
                      }{" "}
                      questions will
                      be created as
                      pending,
                      unpublished
                      Drafts.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={
                    confirmImport
                  }
                  disabled={
                    busy
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#3d4145] px-6 text-sm font-semibold text-white hover:bg-[#292d30] disabled:opacity-50"
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
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <XCircle
                  aria-hidden="true"
                  className="mt-0.5 size-5 text-red-700"
                />

                <div>
                  <h2 className="font-semibold">
                    Import blocked
                  </h2>
                  <p className="mt-1 text-sm text-[#646b70]">
                    Fix all{" "}
                    {
                      batch.error_rows
                    }{" "}
                    row
                    {batch.error_rows ===
                    1
                      ? ""
                      : "s"}{" "}
                    with errors
                    before importing.
                    No questions have
                    been created.
                  </p>
                </div>
              </div>
            )}
          </div>
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
            Question Bank as
            pending Drafts.
          </p>

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
    </section>
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
      className={`rounded-md border p-4 ${classes}`}
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
      <tr className="border-t border-[#e1e3e5] align-top">
        <td className="px-4 py-4 font-medium">
          {row.row_number}
        </td>

        <td className="max-w-[320px] px-4 py-4">
          {row.question_text ??
            "—"}
        </td>

        <td className="px-4 py-4">
          {row.certification_code ??
            "—"}
        </td>

        <td className="px-4 py-4">
          {row.category_name ??
            "Uncategorized"}
        </td>

        <td className="px-4 py-4">
          {typeLabel(
            row.question_type,
          )}
        </td>

        <td className="px-4 py-4">
          {row.image_filename ??
            "—"}
        </td>

        <td className="px-4 py-4">
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
        <tr className="border-t border-[#eceeef] bg-[#fafafa]">
          <td
            colSpan={7}
            className="px-4 py-3"
          >
            <div className="space-y-2">
              {row.issues.map(
                (
                  issue,
                  index,
                ) => (
                  <div
                    key={`${issue.code}-${index}`}
                    className="flex items-start gap-2 text-sm"
                  >
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

                    <div>
                      <span className="font-medium">
                        {
                          issue.code
                        }
                      </span>
                      <span className="text-[#5f666b]">
                        {" "}
                        —{" "}
                        {
                          issue.message
                        }
                      </span>
                    </div>
                  </div>
                ),
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
