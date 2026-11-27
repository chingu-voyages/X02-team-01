import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminQuestionsPage from "./page";
import { getAdminCategories, getAdminCertifications } from "@/lib/admin-catalog-api";
import { getManagedQuestions } from "@/lib/admin-question-api";
import { ApiError } from "@/lib/api-client";
import type { AdminQuestionBankItem, AdminQuestionBankListResponse } from "@/types/admin-question-api.types";

const { handleError } = vi.hoisted(() => ({ handleError: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "admin-token", role: "administrator", ready: true, handleError }),
}));
vi.mock("@/lib/admin-catalog-api", () => ({ getAdminCategories: vi.fn(), getAdminCertifications: vi.fn() }));
vi.mock("@/lib/admin-question-api", () => ({ getManagedQuestions: vi.fn() }));

const certification = { id: "cert-a", name: "Computer Science", code: "CS-100", passing_threshold_pct: 70, feedback_mode: "immediate" as const, is_published: true };
const category = { id: "cat-a", certification_id: certification.id, certification_name: certification.name, name: "Data Structures", is_published: true };
const question: AdminQuestionBankItem = {
  question_id: "33333333-3333-4333-8333-333333333333", question_version_id: "version-a", version_number: 1,
  question_preview: "What is a queue?", certification_id: certification.id, certification_name: certification.name,
  category_id: category.id, category_name: category.name, difficulty: "medium", question_type: "multiple_choice",
  review_status: "pending", publication_status: "draft", is_flagged: false, has_image: true, created_by_id: "owner-a", last_updated: "2026-11-27T12:00:00Z",
};
const mockBank = vi.mocked(getManagedQuestions);
const mockCerts = vi.mocked(getAdminCertifications);
const mockCategories = vi.mocked(getAdminCategories);

async function openPage() {
  const user = userEvent.setup();
  render(<AdminQuestionsPage />);
  await screen.findByText(question.question_preview);
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockBank.mockResolvedValue({ items: [question], count: 76 });
  mockCerts.mockResolvedValue([certification]);
  mockCategories.mockResolvedValue([category]);
});
afterEach(cleanup);

describe("Question Bank responsive page and error recovery", () => {
  it("discloses filters, counts active filters, and clears them without changing the query contract", async () => {
    const user = await openPage();
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.selectOptions(screen.getByLabelText("Certification"), certification.id);
    await user.selectOptions(screen.getByLabelText("Category"), category.id);
    await user.selectOptions(screen.getByLabelText("Workflow status"), "pending");
    await waitFor(() => expect(mockBank).toHaveBeenLastCalledWith("admin-token", expect.objectContaining({ certification_id: certification.id, category_id: category.id, review_status: "pending", page: 1, page_size: 50 })));
    expect(screen.getByRole("button", { name: "Filters (3 active)" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(mockBank).toHaveBeenLastCalledWith("admin-token", { page: 1, page_size: 50 }));
    expect((screen.getByLabelText("Certification") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("all");
  });

  it("clears a category when the selected certification changes", async () => {
    const user = await openPage();
    await user.selectOptions(screen.getByLabelText("Category"), category.id);
    await user.selectOptions(screen.getByLabelText("Certification"), certification.id);
    await waitFor(() => expect(mockBank).toHaveBeenLastCalledWith("admin-token", { page: 1, page_size: 50, certification_id: certification.id }));
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("all");
  });

  it("shows catalog filter failure separately and retries without discarding the bank", async () => {
    mockCerts.mockRejectedValueOnce(new ApiError(503, "Unavailable"));
    const user = await openPage();
    expect(await screen.findByText(/Catalog filters could not be loaded/)).toBeTruthy();
    expect((screen.getByLabelText("Certification") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(question.question_preview)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry catalog filters" }));
    await waitFor(() => expect((screen.getByLabelText("Certification") as HTMLSelectElement).disabled).toBe(false));
    expect(mockCerts).toHaveBeenCalledTimes(2);
    expect(mockBank).toHaveBeenCalledTimes(1);
  });

  it("preserves a selected filter after a failed question request and retries that query", async () => {
    const user = await openPage();
    mockBank.mockRejectedValueOnce(new ApiError(503, "Unavailable"));
    await user.selectOptions(screen.getByLabelText("Difficulty"), "hard");
    expect(await screen.findByText(/Your search and filters have been kept/)).toBeTruthy();
    expect((screen.getByLabelText("Difficulty") as HTMLSelectElement).value).toBe("hard");
    expect(screen.queryByRole("table", { name: "Question Bank results" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(question.question_preview)).toBeTruthy();
    expect(mockBank).toHaveBeenLastCalledWith("admin-token", { page: 1, page_size: 50, difficulty: "hard" });
  });

  it("does not let a late response overwrite a newer filter's result", async () => {
    const user = await openPage();
    let resolveOld!: (result: AdminQuestionBankListResponse) => void;
    mockBank.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await user.selectOptions(screen.getByLabelText("Difficulty"), "easy");
    await waitFor(() => expect(mockBank).toHaveBeenLastCalledWith("admin-token", { page: 1, page_size: 50, difficulty: "easy" }));
    mockBank.mockResolvedValueOnce({ items: [{ ...question, question_preview: "Newest filtered question" }], count: 1 });
    await user.selectOptions(screen.getByLabelText("Difficulty"), "hard");
    await screen.findByText("Newest filtered question");
    await act(async () => resolveOld({ items: [{ ...question, question_preview: "Stale result" }], count: 1 }));
    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByText("Newest filtered question")).toBeTruthy();
  });

  it("moves keyboard focus to the results heading when changing pages", async () => {
    const user = await openPage();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Questions" }));
    await waitFor(() => expect(mockBank).toHaveBeenLastCalledWith("admin-token", { page: 2, page_size: 50 }));
  });

  it("removes content-management actions after the backend denies access", async () => {
    mockBank.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<AdminQuestionsPage />);
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Import Questions" })).toBeNull();
    expect(screen.queryByRole("link", { name: "+ Create Question" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
