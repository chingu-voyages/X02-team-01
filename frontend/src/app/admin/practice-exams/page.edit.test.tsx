import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPracticeExamsPage from "./page";
import { ApiError } from "@/lib/api-client";
import { getAdminCategories, getAdminCertifications } from "@/lib/admin-catalog-api";
import {
  createAdminPracticeExam,
  getAdminPracticeExams,
  setAdminPracticeExamPublication,
  updateAdminPracticeExam,
} from "@/lib/admin-practice-exam-api";
import type { AdminPracticeExam } from "@/types/admin-practice-exam-api.types";

const auth = vi.hoisted(() => ({
  role: "administrator" as "administrator" | "contributor" | "learner",
  handleError: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "admin-token",
    role: auth.role,
    ready: true,
    handleError: auth.handleError,
  }),
}));

vi.mock("@/lib/admin-catalog-api", () => ({
  getAdminCategories: vi.fn(),
  getAdminCertifications: vi.fn(),
}));

vi.mock("@/lib/admin-practice-exam-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-practice-exam-api")>();
  return {
    ...actual,
    getAdminPracticeExams: vi.fn(),
    getAdminPracticeExam: vi.fn(),
    createAdminPracticeExam: vi.fn(),
    updateAdminPracticeExam: vi.fn(),
    setAdminPracticeExamPublication: vi.fn(),
  };
});

const certification = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Computer Science",
  code: "CS-100",
  passing_threshold_pct: 70,
  feedback_mode: "immediate" as const,
  is_published: true,
};
const category = {
  id: "33333333-3333-4333-8333-333333333333",
  certification_id: certification.id,
  certification_name: certification.name,
  name: "Science",
  is_published: true,
};
const secondCertification = { ...certification, id: "other-cert", name: "Other certification" };
const secondCategory = {
  ...category,
  id: "other-category",
  certification_id: secondCertification.id,
  certification_name: secondCertification.name,
  name: "Other category",
};
const draft: AdminPracticeExam = {
  id: "44444444-4444-4444-8444-444444444444",
  certification_id: certification.id,
  certification_name: certification.name,
  category_id: category.id,
  category_name: category.name,
  name: "Science practice",
  question_count: 2,
  status: "draft",
  readiness: {
    ready: true,
    required_question_count: 2,
    eligible_question_count: 5,
    issues: [],
  },
};
const update = vi.mocked(updateAdminPracticeExam);
const list = vi.mocked(getAdminPracticeExams);

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "administrator";
  list.mockResolvedValue([draft]);
  vi.mocked(getAdminCertifications).mockResolvedValue([certification, secondCertification]);
  vi.mocked(getAdminCategories).mockResolvedValue([category, secondCategory]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openEditor(exam: AdminPracticeExam = draft) {
  list.mockResolvedValue([exam]);
  const user = userEvent.setup();
  render(<AdminPracticeExamsPage />);
  await user.click(await screen.findByRole("button", { name: "Edit exam" }));
  const form = screen.getByRole("form", { name: "Edit practice exam" });
  return { user, form, fields: within(form) };
}

describe("JHEP-107 exam configuration editing", () => {
  it("prefills the draft and updates the same exam, using server readiness", async () => {
    const saved: AdminPracticeExam = {
      ...draft,
      name: "Updated exam",
      question_count: 6,
      readiness: {
        ready: false,
        required_question_count: 6,
        eligible_question_count: 5,
        issues: [{ code: "INSUFFICIENT_PUBLISHED_QUESTIONS", message: "Need 6 eligible published questions; only 5 available." }],
      },
    };
    update.mockResolvedValue(saved);
    const { user, fields } = await openEditor();
    const name = fields.getByLabelText("Exam name");
    const count = fields.getByLabelText("Question count (1–100)");
    expect(name).toHaveProperty("value", draft.name);
    expect(fields.getByLabelText("Certification")).toHaveProperty("value", certification.id);
    expect(fields.getByLabelText("Category")).toHaveProperty("value", category.id);
    expect(count).toHaveProperty("value", "2");
    expect(screen.getByRole("button", { name: "Publish exam" })).toHaveProperty("disabled", true);
    await user.clear(name);
    await user.type(name, "Updated exam");
    await user.clear(count);
    await user.type(count, "6");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("admin-token", draft.id, {
      name: "Updated exam",
      certification_id: certification.id,
      category_id: category.id,
      question_count: 6,
    }));
    expect((await screen.findByRole("button", { name: "Manage Updated exam" })).textContent).toContain("6 questions");
    expect(screen.queryByRole("button", { name: "Manage Science practice" })).toBeNull();
    expect(screen.getByText("Need 6 eligible published questions; only 5 available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish exam" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("form", { name: "Edit practice exam" })).toBeNull();
    expect(createAdminPracticeExam).not.toHaveBeenCalled();
    expect(setAdminPracticeExamPublication).not.toHaveBeenCalled();
  });

  it("allows a draft to change its certification and category", async () => {
    update.mockResolvedValue({ ...draft, certification_id: secondCertification.id, certification_name: secondCertification.name, category_id: secondCategory.id, category_name: secondCategory.name });
    const { user, fields } = await openEditor();
    await user.selectOptions(fields.getByLabelText("Certification"), secondCertification.id);
    const categoryField = fields.getByLabelText("Category");
    expect(categoryField).toHaveProperty("value", "");
    await user.selectOptions(categoryField, secondCategory.id);
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("admin-token", draft.id, {
      name: draft.name,
      certification_id: secondCertification.id,
      category_id: secondCategory.id,
      question_count: 2,
    }));
  });

  it.each(["", "0", "101", "1.5", "-1"])("rejects invalid question count %j without writing", async (invalid) => {
    const { user, fields } = await openEditor();
    fireEvent.change(fields.getByLabelText("Question count (1–100)"), { target: { value: invalid } });
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    expect(fields.getByRole("alert").textContent).toContain("Check the highlighted fields");
    const field = fields.getByLabelText("Question count (1–100)");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain("exam-count-error");
    expect(fields.getByText("Enter a whole-number question count from 1 to 100.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(update).not.toHaveBeenCalled();
  });

  it.each([1, 100])("accepts valid boundary count %d for a draft", async (count) => {
    update.mockResolvedValue({ ...draft, question_count: count });
    const { user, fields } = await openEditor();
    fireEvent.change(fields.getByLabelText("Question count (1–100)"), { target: { value: String(count) } });
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("admin-token", draft.id, expect.objectContaining({ question_count: count })));
  });

  it("allows a missing draft count to be configured", async () => {
    update.mockResolvedValue(draft);
    const { user, fields } = await openEditor({ ...draft, question_count: null, readiness: { ...draft.readiness, ready: false, required_question_count: null, issues: [{ code: "QUESTION_COUNT_MISSING", message: "Configure the count." }] } });
    const count = fields.getByLabelText("Question count (1–100)");
    expect(count).toHaveProperty("value", "");
    await user.type(count, "2");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("admin-token", draft.id, expect.objectContaining({ question_count: 2 })));
  });

  it("shows the last checked eligible pool and explains a count above it", async () => {
    const { user, fields } = await openEditor();
    const count = fields.getByLabelText("Question count (1–100)");
    expect(fields.getByText("5 eligible published questions")).toBeTruthy();
    fireEvent.change(count, { target: { value: "6" } });
    expect(fields.getByText(/You can save this configuration, but publishing requires/)).toBeTruthy();
    expect(fields.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false);
    await user.selectOptions(fields.getByLabelText("Certification"), secondCertification.id);
    expect(fields.queryByText("5 eligible published questions")).toBeNull();
    expect(fields.getByText("Question availability will be checked after you save.")).toBeTruthy();
  });

  it("returns keyboard focus to the edit button after cancellation", async () => {
    const { user, fields } = await openEditor();
    await user.click(fields.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit exam" })));
  });

  it("focuses the updated exam details after a successful save", async () => {
    update.mockResolvedValue(draft);
    const { user, fields } = await openEditor();
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: draft.name })));
    expect(screen.getByText(/Changes saved for/)).toBeTruthy();
  });

  it("locks name and scope when editing a previously unpublished exam", async () => {
    const unpublished: AdminPracticeExam = { ...draft, status: "unpublished" };
    update.mockResolvedValue({ ...unpublished, question_count: 3 });
    const { user, fields } = await openEditor(unpublished);
    expect(fields.getByLabelText("Exam name")).toHaveProperty("disabled", true);
    expect(fields.getByLabelText("Certification")).toHaveProperty("disabled", true);
    expect(fields.getByLabelText("Category")).toHaveProperty("disabled", true);
    const count = fields.getByLabelText("Question count (1–100)");
    expect(count).toHaveProperty("disabled", false);
    await user.clear(count);
    await user.type(count, "3");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("admin-token", draft.id, {
      name: draft.name, certification_id: certification.id, category_id: category.id, question_count: 3,
    }));
  });

  it("does not expose editing on a published exam", async () => {
    list.mockResolvedValue([{ ...draft, status: "published" }]);
    render(<AdminPracticeExamsPage />);
    expect(await screen.findByRole("button", { name: "Unpublish exam" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit exam" })).toBeNull();
  });

  it("cancels without a write and clears old values before creating another draft", async () => {
    const { user, fields } = await openEditor();
    await user.clear(fields.getByLabelText("Exam name"));
    await user.type(fields.getByLabelText("Exam name"), "Discard this");
    await user.click(fields.getByRole("button", { name: "Cancel" }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit practice exam" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish exam" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "New exam" }));
    expect(screen.getByLabelText("Exam name")).toHaveProperty("value", "");
  });

  it("preserves the editor and shows the server error if saving is rejected", async () => {
    update.mockRejectedValue(new ApiError(409, "Unpublish the practice exam before editing"));
    const { user, fields } = await openEditor();
    const count = fields.getByLabelText("Question count (1–100)");
    await user.clear(count);
    await user.type(count, "4");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    expect((await fields.findByRole("alert")).textContent).toContain("Unpublish the practice exam before editing");
    expect(count).toHaveProperty("value", "4");
    expect(screen.queryByText(/Changes saved for/)).toBeNull();
    expect(screen.getByRole("button", { name: "Manage Science practice" }).textContent).toContain("2 questions");
  });

  it("shows separate inline errors and focuses the first invalid field", async () => {
    const { user, fields } = await openEditor();
    const name = fields.getByLabelText("Exam name");
    const certificationField = fields.getByLabelText("Certification");
    const categoryField = fields.getByLabelText("Category");
    await user.clear(name);
    await user.selectOptions(certificationField, "");
    fireEvent.change(fields.getByLabelText("Question count (1–100)"), { target: { value: "0" } });
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    expect(fields.getByRole("alert").textContent).toContain("Check the highlighted fields");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(certificationField.getAttribute("aria-invalid")).toBe("true");
    expect(categoryField.getAttribute("aria-invalid")).toBe("true");
    expect(fields.getByText("Enter an exam name (1–255 characters).")).toBeTruthy();
    expect(fields.getByText("Select a certification.")).toBeTruthy();
    expect(fields.getByText("Select a category in the chosen certification.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(update).not.toHaveBeenCalled();
    await user.type(name, "Valid name");
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(certificationField.getAttribute("aria-invalid")).toBe("true");
  });

  it("places a duplicate-name conflict beside the name field", async () => {
    update.mockRejectedValue(new ApiError(409, "Exam name already exists in category", "Exam name already exists in category"));
    const { user, fields } = await openEditor();
    const name = fields.getByLabelText("Exam name");
    await user.clear(name);
    await user.type(name, "Duplicate exam");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    expect(await fields.findByText(/An exam with this name already exists/)).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name).toHaveProperty("value", "Duplicate exam");
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("maps server validation details to the relevant count field", async () => {
    update.mockRejectedValue(new ApiError(422, "API request failed (422)", [
      { loc: ["body", "question_count"], msg: "Input should be less than or equal to 100" },
    ]));
    const { user, fields } = await openEditor();
    const count = fields.getByLabelText("Question count (1–100)");
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    expect(await fields.findByText("Enter a whole-number question count from 1 to 100.")).toBeTruthy();
    expect(count.getAttribute("aria-invalid")).toBe("true");
    expect(count).toHaveProperty("value", "2");
    await waitFor(() => expect(document.activeElement).toBe(count));
  });

  it("explains a network error without discarding entered values", async () => {
    update.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, fields } = await openEditor();
    const count = fields.getByLabelText("Question count (1–100)");
    fireEvent.change(count, { target: { value: "4" } });
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    const notice = await fields.findByRole("alert");
    expect(notice.textContent).toContain("Check your connection and try again.");
    expect(notice.textContent).toContain("Your entries are still here.");
    expect(count).toHaveProperty("value", "4");
    await waitFor(() => expect(document.activeElement).toBe(notice.parentElement));
    expect(fields.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false);
  });

  it("switches mobile list and detail panels while preserving search", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);
    const exam = await screen.findByRole("button", { name: "Manage Science practice" });
    const listHeading = screen.getByRole("heading", { name: "All practice exams" });
    const detailHeading = screen.getByRole("heading", { name: draft.name });
    const listPanel = listHeading.closest("section");
    const detailsPanel = detailHeading.closest("section");
    expect(listPanel?.classList.contains("hidden")).toBe(false);
    expect(detailsPanel?.classList.contains("hidden")).toBe(true);
    await user.type(screen.getByLabelText("Search practice exams"), "Science");
    await user.click(exam);
    expect(listPanel?.classList.contains("hidden")).toBe(true);
    expect(detailsPanel?.classList.contains("hidden")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(detailHeading));
    await user.click(screen.getByRole("button", { name: "Back to exam list" }));
    expect(listPanel?.classList.contains("hidden")).toBe(false);
    expect(detailsPanel?.classList.contains("hidden")).toBe(true);
    expect(screen.getByLabelText("Search practice exams")).toHaveProperty("value", "Science");
    await waitFor(() => expect(document.activeElement).toBe(listHeading));
  });

  it("keeps the mobile detail view available after saving an edit", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    update.mockResolvedValue(draft);
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);
    await user.click(await screen.findByRole("button", { name: "Manage Science practice" }));
    await user.click(screen.getByRole("button", { name: "Edit exam" }));
    const fields = within(screen.getByRole("form", { name: "Edit practice exam" }));
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    const message = await screen.findByText(/Changes saved for/);
    expect(message.closest("section")?.classList.contains("hidden")).toBe(false);
    expect(screen.queryByRole("form", { name: "Edit practice exam" })).toBeNull();
  });

  it("routes an expired save session to the shared session handler", async () => {
    const error = new ApiError(401, "Session expired");
    update.mockRejectedValue(error);
    const { user, fields } = await openEditor();
    await user.click(fields.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(auth.handleError).toHaveBeenCalledWith(error));
  });

  it.each(["learner", "contributor"] as const)("does not expose editing to %s", (role) => {
    auth.role = role;
    render(<AdminPracticeExamsPage />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit exam" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
