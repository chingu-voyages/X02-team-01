import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdminQuestionsPage from "./AdminQuestionsPage";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { getManagedQuestions } from "@/lib/admin-question-api";
import type { AdminQuestionBankItem } from "@/types/admin-question-api.types";

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: vi.fn(),
}));

vi.mock("@/lib/admin-question-api", () => ({
  getManagedQuestions: vi.fn(),
}));

const mockHandleError = vi.fn();

const sampleQuestions: AdminQuestionBankItem[] = [
  {
    question_id: "11111111-aaaa-bbbb-cccc-111111111111",
    question_preview: "What are the three pillars of empiricism?",
    question_type: "multiple_choice",
    category_name: "Empiricism",
    publication_status: "active",
    review_status: "approved",
    last_updated: "2026-03-10T10:00:00Z",
  } as AdminQuestionBankItem,
  {
    question_id: "22222222-aaaa-bbbb-cccc-222222222222",
    question_preview: "Explain the purpose of the Daily Scrum.",
    question_type: "short_answer",
    category_name: "Scrum Events",
    publication_status: "draft",
    review_status: "pending",
    last_updated: "2026-03-12T10:00:00Z",
  } as AdminQuestionBankItem,
  {
    question_id: "33333333-aaaa-bbbb-cccc-333333333333",
    question_preview: "Who is accountable for maximizing product value?",
    question_type: "multiple_choice",
    category_name: "Accountabilities",
    publication_status: "retired",
    review_status: "approved",
    last_updated: "2026-03-14T10:00:00Z",
  } as AdminQuestionBankItem,
];

describe("AdminQuestionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDemoSession).mockReturnValue({
      token: "admin-token",
      ready: true,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);
  });

  afterEach(() => {
    cleanup();
  });

  it("displays session check status before auth is ready", () => {
    vi.mocked(useDemoSession).mockReturnValue({
      token: null,
      ready: false,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);

    render(<AdminQuestionsPage />);

    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(getManagedQuestions).not.toHaveBeenCalled();
  });

  it("loads and renders questions, Create Question link, and sorted category options", async () => {
    vi.mocked(getManagedQuestions).mockResolvedValueOnce({
      items: sampleQuestions,
    } as Awaited<ReturnType<typeof getManagedQuestions>>);

    render(<AdminQuestionsPage />);

    expect(screen.getByRole("status").textContent).toBe(
      "Loading question bank...",
    );

    expect(
      await screen.findByText("What are the three pillars of empiricism?"),
    ).toBeTruthy();
    expect(
      screen.getByText("Explain the purpose of the Daily Scrum."),
    ).toBeTruthy();
    expect(
      screen.getByText("Who is accountable for maximizing product value?"),
    ).toBeTruthy();

    const createLink = screen.getByRole("link", { name: "+ Create Question" });
    expect(createLink.getAttribute("href")).toBe("/admin/questions/new");

    const categoryOptions = Array.from(
      screen.getByLabelText("Category").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(categoryOptions).toEqual([
      "Category",
      "Accountabilities",
      "Empiricism",
      "Scrum Events",
    ]);
  });

  it("delegates 401 ApiError to handleError", async () => {
    const unauthorizedError = new ApiError(401, "Unauthorized", null);
    vi.mocked(getManagedQuestions).mockRejectedValueOnce(unauthorizedError);

    render(<AdminQuestionsPage />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(unauthorizedError);
    });
  });

  it("renders Access denied alert on 403 ApiError", async () => {
    vi.mocked(getManagedQuestions).mockRejectedValueOnce(
      new ApiError(403, "Forbidden", null),
    );

    render(<AdminQuestionsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Access denied");
  });

  it("renders error state and retries loading when Retry is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getManagedQuestions)
      .mockRejectedValueOnce(new Error("Failed to fetch question bank"))
      .mockResolvedValueOnce({
        items: sampleQuestions,
      } as Awaited<ReturnType<typeof getManagedQuestions>>);

    render(<AdminQuestionsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Failed to fetch question bank");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("What are the three pillars of empiricism?"),
    ).toBeTruthy();
    expect(getManagedQuestions).toHaveBeenCalledTimes(2);
  });

  it("filters questions by search query (text and short ID), type, status, and category", async () => {
    const user = userEvent.setup();
    vi.mocked(getManagedQuestions).mockResolvedValueOnce({
      items: sampleQuestions,
    } as Awaited<ReturnType<typeof getManagedQuestions>>);

    render(<AdminQuestionsPage />);

    await screen.findByText("What are the three pillars of empiricism?");

    // Search by short ID
    const searchInput = screen.getByPlaceholderText("Search by question or ID");
    fireEvent.change(searchInput, { target: { value: "Q-22222222" } });

    expect(
      screen.getByText("Explain the purpose of the Daily Scrum."),
    ).toBeTruthy();
    expect(
      screen.queryByText("What are the three pillars of empiricism?"),
    ).toBeNull();

    // Clear search and filter by question type + status + category
    fireEvent.change(searchInput, { target: { value: "" } });

    await user.selectOptions(
      screen.getByLabelText("Question type"),
      "multiple_choice",
    );
    await user.selectOptions(screen.getByLabelText("Status"), "Retired");
    await user.selectOptions(
      screen.getByLabelText("Category"),
      "Accountabilities",
    );

    expect(
      screen.getByText("Who is accountable for maximizing product value?"),
    ).toBeTruthy();
    expect(
      screen.queryByText("What are the three pillars of empiricism?"),
    ).toBeNull();
    expect(screen.getByText("Showing 1–1 of 1 questions")).toBeTruthy();
  });

  it("paginates results across pages and resets to page 1 when a filter changes", async () => {
    const user = userEvent.setup();
    const twelveQuestions: AdminQuestionBankItem[] = Array.from(
      { length: 12 },
      (_, index) =>
        ({
          question_id: `${String(index + 1).padStart(8, "0")}-aaaa-bbbb-cccc-000000000000`,
          question_preview: `Question item ${index + 1}`,
          question_type: "multiple_choice",
          category_name: "Empiricism",
          publication_status: "active",
          review_status: "approved",
          last_updated: "2026-03-15T10:00:00Z",
        }) as AdminQuestionBankItem,
    );

    vi.mocked(getManagedQuestions).mockResolvedValueOnce({
      items: twelveQuestions,
    } as Awaited<ReturnType<typeof getManagedQuestions>>);

    render(<AdminQuestionsPage />);

    await screen.findByText("Question item 1");
    expect(screen.getByText("Showing 1–10 of 12 questions")).toBeTruthy();
    expect(screen.queryByText("Question item 11")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Question item 11")).toBeTruthy();
    expect(screen.getByText("Question item 12")).toBeTruthy();
    expect(screen.getByText("Showing 11–12 of 12 questions")).toBeTruthy();

    // Changing a filter resets back to page 1
    fireEvent.change(screen.getByPlaceholderText("Search by question or ID"), {
      target: { value: "Question item" },
    });

    expect(screen.getByText("Showing 1–10 of 12 questions")).toBeTruthy();
  });
});