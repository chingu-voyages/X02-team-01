import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPracticeExamsPage from "./page";
import { ApiError } from "@/lib/api-client";
import { getAdminCategories, getAdminCertifications } from "@/lib/admin-catalog-api";
import {
  deleteAdminPracticeExam,
  getAdminPracticeExams,
  setAdminPracticeExamPublication,
} from "@/lib/admin-practice-exam-api";
import type { AdminPracticeExam } from "@/types/admin-practice-exam-api.types";

const auth = vi.hoisted(() => ({
  role: "administrator" as "administrator" | "learner" | "contributor",
  handleError: vi.fn(),
}));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "admin-token", ready: true, role: auth.role, handleError: auth.handleError }),
}));
vi.mock("@/lib/admin-catalog-api", () => ({
  getAdminCategories: vi.fn(),
  getAdminCertifications: vi.fn(),
}));
vi.mock("@/lib/admin-practice-exam-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-practice-exam-api")>()),
  getAdminPracticeExams: vi.fn(),
  getAdminPracticeExam: vi.fn(),
  deleteAdminPracticeExam: vi.fn(),
  setAdminPracticeExamPublication: vi.fn(),
}));

const certification = {
  id: "cert-id", name: "Computer Science", code: "CS-100",
  passing_threshold_pct: 70, feedback_mode: "immediate" as const, is_published: true,
};
const category = {
  id: "category-id", certification_id: certification.id,
  certification_name: certification.name, name: "Science", is_published: true,
};
const draft: AdminPracticeExam = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Science practice", status: "draft", question_count: 2,
  certification_id: certification.id, certification_name: certification.name,
  category_id: category.id, category_name: category.name,
  readiness: { ready: true, required_question_count: 2, eligible_question_count: 5, issues: [] },
};
const sibling: AdminPracticeExam = {
  ...draft, id: "22222222-2222-4222-8222-222222222222", name: "Science practice II",
};
const list = vi.mocked(getAdminPracticeExams);
const remove = vi.mocked(deleteAdminPracticeExam);
const publication = vi.mocked(setAdminPracticeExamPublication);

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "administrator";
  list.mockResolvedValue([draft, sibling]);
  remove.mockResolvedValue(undefined);
  vi.mocked(getAdminCertifications).mockResolvedValue([certification]);
  vi.mocked(getAdminCategories).mockResolvedValue([category]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openDetails(exam: AdminPracticeExam = draft) {
  const user = userEvent.setup();
  render(<AdminPracticeExamsPage />);
  await user.click(await screen.findByRole("button", { name: `Manage ${exam.name}` }));
  return user;
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete exam" }));
  return within(screen.getByRole("dialog", { name: "Delete practice exam?" }));
}

function deleteButton() { return screen.getByRole("button", { name: "Delete exam" }); }
function deleteRegion() { return within(screen.getByRole("region", { name: "Delete practice exam" })); }
function conflict(code: string) { return new ApiError(409, "API request failed (409)", { code, message: "Deletion blocked" }); }

describe("JHEP-207 safe practice exam deletion", () => {
  it("requires a named irreversible-action confirmation and focuses Cancel", async () => {
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    expect(dialog.getByText(draft.name)).toBeTruthy();
    expect(dialog.getByText("This action cannot be undone.")).toBeTruthy();
    expect(dialog.getByText(/not the questions, certification, or category/)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Cancel" }));
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(deleteButton());
  });

  it("traps keyboard focus and allows Escape before the request", async () => {
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Confirm delete" }));
    await user.tab();
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(["draft", "unpublished"] as const)("deletes only the confirmed %s and returns to the list", async (status) => {
    list.mockResolvedValue([{ ...draft, status }, sibling]);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("admin-token", draft.id));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/was deleted successfully/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Manage ${draft.name}` })).toBeNull();
    expect(screen.getByRole("button", { name: `Manage ${sibling.name}` })).toBeTruthy();
    expect(publication).not.toHaveBeenCalled();
    const heading = screen.getByRole("heading", { name: "All practice exams" });
    expect(heading.closest("section")?.classList.contains("hidden")).toBe(false);
    expect(document.activeElement).toBe(heading);
  });

  it("keeps the list visible and actionable after deleting the last exam", async () => {
    list.mockResolvedValue([draft]);
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText(/No practice exams yet/)).toBeTruthy();
    expect(screen.getByText(/was deleted successfully/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "New exam" }).matches(":disabled")).toBe(false);
  });

  it("does not offer destructive action for a published exam", async () => {
    list.mockResolvedValue([{ ...draft, status: "published" }]);
    const user = await openDetails();
    expect(deleteRegion().getByText("Unpublish this exam before deleting it.")).toBeTruthy();
    expect(deleteButton().matches(":disabled")).toBe(true);
    await user.click(deleteButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("allows only one request and keeps controls locked while deleting", async () => {
    let finish!: () => void;
    remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.dblClick(dialog.getByRole("button", { name: "Confirm delete" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(dialog.getByRole("button", { name: "Deleting..." }).matches(":disabled")).toBe(true);
    expect(dialog.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "New exam" }).matches(":disabled")).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Manage ${draft.name}` })).toBeTruthy();
    await act(async () => finish());
    expect(await screen.findByText(/was deleted successfully/)).toBeTruthy();
  });

  it("keeps exams with learner history and remembers their protection", async () => {
    list.mockResolvedValue([{ ...draft, status: "unpublished" }, sibling]);
    remove.mockRejectedValueOnce(conflict("PRACTICE_EXAM_HAS_ATTEMPTS"));
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    const notice = await deleteRegion().findByRole("alert");
    expect(notice.textContent).toContain("Keep it unpublished to protect existing answers and results.");
    expect(document.activeElement).toBe(notice.parentElement);
    expect(deleteButton().matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: `Manage ${draft.name}` })).toBeTruthy();
    expect(screen.queryByText(/was deleted successfully/)).toBeNull();
    await user.click(screen.getByRole("button", { name: `Manage ${sibling.name}` }));
    expect(deleteButton().matches(":disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: `Manage ${draft.name}` }));
    expect(deleteButton().matches(":disabled")).toBe(true);
    expect(deleteRegion().getByText("Protected learner history")).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    [conflict("PRACTICE_EXAM_PUBLISHED"), "Exam is published"],
    [conflict("PRACTICE_EXAM_DELETE_CONFLICT"), "linked to other records"],
    [new ApiError(404, "Practice exam not found"), "Exam not found"],
    [new TypeError("Failed to fetch"), "Could not confirm deletion"],
    [new ApiError(503, "Unavailable"), "Could not confirm deletion"],
  ] as const)("recovers from a rejected or uncertain deletion (%s)", async (error, message) => {
    remove.mockRejectedValueOnce(error);
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    expect((await deleteRegion().findByRole("alert")).textContent).toContain(message);
    expect(screen.getByRole("button", { name: `Manage ${draft.name}` })).toBeTruthy();
    expect(screen.queryByText(/was deleted successfully/)).toBeNull();
    expect(deleteButton().matches(":disabled")).toBe(true);
    list.mockResolvedValueOnce([sibling]);
    await user.click(deleteRegion().getByRole("button", { name: "Refresh exams" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `Manage ${draft.name}` })).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/was deleted successfully/)).toBeNull();
  });

  it("reports permission denial without removing the exam", async () => {
    remove.mockRejectedValueOnce(new ApiError(403, "Forbidden"));
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    expect((await deleteRegion().findByRole("alert")).textContent).toContain("Administrator access is required");
    expect(screen.getByRole("button", { name: `Manage ${draft.name}` })).toBeTruthy();
  });

  it("uses the shared handler on session expiration", async () => {
    const error = new ApiError(401, "Session expired");
    remove.mockRejectedValueOnce(error);
    const user = await openDetails();
    const dialog = await openConfirmation(user);
    await user.click(dialog.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(auth.handleError).toHaveBeenCalledWith(error));
    expect(screen.queryByText(/was deleted successfully/)).toBeNull();
  });

  it.each(["learner", "contributor"] as const)("does not expose deletion to %s", (role) => {
    auth.role = role;
    render(<AdminPracticeExamsPage />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete exam" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
