import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuestionImportPage from "./page";
import {
  commitQuestionImport,
  getQuestionImportHistory,
  getQuestionImportRows,
  revalidateQuestionImport,
  uploadQuestionImport,
} from "@/lib/question-import-api";
import { confirmImportCatalog, getImportCatalogPlan, type ImportCatalogPlan } from "@/lib/question-import-catalog-api";
import type { QuestionImportBatch, QuestionImportRow } from "@/types/question-import-api.types";

const { handleError } = vi.hoisted(() => ({ handleError: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({ useDemoSession: () => ({ token: "admin-token", role: "administrator", ready: true, handleError }) }));
vi.mock("@/lib/question-import-api", () => ({
  cancelQuestionImport: vi.fn(), commitQuestionImport: vi.fn(), getQuestionImport: vi.fn(),
  getQuestionImportHistory: vi.fn(), getQuestionImportRows: vi.fn(), publishQuestionImport: vi.fn(),
  revalidateQuestionImport: vi.fn(), uploadQuestionImport: vi.fn(), uploadQuestionImportAsset: vi.fn(),
}));
vi.mock("@/lib/question-import-catalog-api", () => ({ getImportCatalogPlan: vi.fn(), confirmImportCatalog: vi.fn() }));

const batch: QuestionImportBatch = {
  id: "11111111-1111-4111-8111-111111111111", original_filename: "questions.xlsx", template_version: "2.0",
  status: "invalid", total_rows: 1, valid_rows: 0, error_rows: 1, warning_rows: 0, imported_rows: 0, can_import: false,
  created_at: "2026-11-27T12:00:00Z", validated_at: "2026-11-27T12:00:01Z", imported_at: null,
};
const row: QuestionImportRow = {
  id: "row-1", row_number: 2, status: "invalid", certification_code: "CS-100", category_name: "Algorithms",
  question_type: "multiple_choice", question_text: "What is a queue?", image_filename: null,
  issues: [{ sheet: "Questions", row: 2, field: "category_name", cell: "C2", severity: "error", code: "CATEGORY_NOT_FOUND", message: "Category does not exist under the selected certification.", value_preview: "Algorithms", related_rows: [], asset_filename: null }],
};
const readyBatch: QuestionImportBatch = { ...batch, status: "ready", valid_rows: 1, error_rows: 0, warning_rows: 1, can_import: true, validated_at: "2026-11-27T12:01:00Z" };
const readyRow: QuestionImportRow = { ...row, status: "valid", issues: [] };
const plan: ImportCatalogPlan = {
  batch_id: batch.id, plan_id: "a".repeat(64), missing_certifications: [],
  missing_categories: [{ certification_code: "CS-100", name: "Algorithms", row_numbers: [2] }], blocking_issues: [], can_confirm: true,
};
const mockRows = vi.mocked(getQuestionImportRows);
const mockConfirmation = vi.mocked(confirmImportCatalog);

function rowsResponse(item: QuestionImportRow) {
  mockRows.mockImplementation(async (_token, _batchId, query) => {
    const items = query?.row_status && query.row_status !== item.status ? [] : [item];
    return { items, total: items.length, page: query?.page ?? 1, page_size: query?.page_size ?? 50 };
  });
}

async function openImport() {
  const user = userEvent.setup();
  render(<QuestionImportPage />);
  await user.upload(screen.getByLabelText("Question bank workbook"), new File(["workbook"], "questions.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  await user.click(screen.getByRole("button", { name: "Validate File" }));
  await screen.findByRole("heading", { name: "Resolve missing catalog records" });
  return user;
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Review missing records" }));
  await user.click(await screen.findByRole("checkbox", { name: "I confirm creation of the listed catalog records." }));
  await user.click(screen.getByRole("button", { name: "Create records & revalidate" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getQuestionImportHistory).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8 });
  vi.mocked(uploadQuestionImport).mockResolvedValue(batch);
  rowsResponse(row);
  vi.mocked(getImportCatalogPlan).mockResolvedValue(plan);
});
afterEach(cleanup);

describe("Import Questions catalog confirmation integration", () => {
  it("keeps question import blocked and does not create catalog records just by validating", async () => {
    await openImport();
    expect(screen.getByRole("heading", { name: "Import blocked" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import 1 Questions" })).toBeNull();
    expect(getImportCatalogPlan).not.toHaveBeenCalled();
    expect(mockConfirmation).not.toHaveBeenCalled();
    expect(commitQuestionImport).not.toHaveBeenCalled();
  });

  it("refreshes the validated preview after confirmation without automatically importing questions", async () => {
    mockConfirmation.mockImplementation(async () => {
      rowsResponse(readyRow);
      return { batch: readyBatch, created_certification_ids: [], created_category_ids: ["new-cat"] };
    });
    const user = await openImport();
    await confirm(user);
    expect(await screen.findByText(/Catalog records created: 1\./)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Ready to import" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Resolve missing catalog records" })).toBeNull();
    expect(screen.getByRole("button", { name: "Import 1 Questions" })).toBeTruthy();
    expect(mockConfirmation).toHaveBeenCalledWith("admin-token", batch.id, { plan_id: plan.plan_id, confirm: true, certifications: [] });
    expect(commitQuestionImport).not.toHaveBeenCalled();
  });

  it("keeps importing blocked when other validation errors remain", async () => {
    const remaining: QuestionImportRow = { ...row, issues: [{ ...row.issues[0], code: "MISSING_IMAGE_FILE", message: "Image file is missing.", asset_filename: "diagram.png" }] };
    mockConfirmation.mockImplementation(async () => {
      rowsResponse(remaining);
      return { batch: { ...batch, validated_at: readyBatch.validated_at }, created_certification_ids: [], created_category_ids: ["new-cat"] };
    });
    const user = await openImport();
    await confirm(user);
    expect(await screen.findByText(/Resolve the remaining validation issues/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add referenced images" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Import blocked" })).toBeTruthy();
    expect(commitQuestionImport).not.toHaveBeenCalled();
  });

  it("does not misreport a completed creation when only the preview refresh fails", async () => {
    mockConfirmation.mockImplementation(async () => {
      mockRows.mockRejectedValue(new Error("Preview unavailable"));
      return { batch: readyBatch, created_certification_ids: [], created_category_ids: ["new-cat"] };
    });
    const user = await openImport();
    await confirm(user);
    expect(await screen.findByText(/Catalog records were created, but the validation preview could not be refreshed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import 1 Questions" })).toBeNull();
    expect(commitQuestionImport).not.toHaveBeenCalled();
    vi.mocked(revalidateQuestionImport).mockResolvedValue(readyBatch);
    rowsResponse(readyRow);
    await user.click(screen.getByRole("button", { name: "Revalidate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 Questions" })).toBeTruthy());
    expect(mockConfirmation).toHaveBeenCalledTimes(1);
  });
});
