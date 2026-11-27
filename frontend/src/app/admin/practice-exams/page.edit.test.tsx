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

afterEach(cleanup);

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
    expect(fields.getByRole("alert").textContent).toBe("Enter a whole-number question count from 1 to 100.");
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
