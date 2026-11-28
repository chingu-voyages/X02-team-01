import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestionBankResults, { canEditBankQuestion, questionBankStatus } from "./QuestionBankResults";
import type { AdminQuestionBankItem } from "@/types/admin-question-api.types";

const ownerId = "55555555-5555-4555-8555-555555555555";
const draft: AdminQuestionBankItem = {
  question_id: "33333333-3333-4333-8333-333333333333",
  question_version_id: "44444444-4444-4444-8444-444444444444",
  version_number: 1,
  question_preview: "What is a queue?",
  certification_id: "11111111-1111-4111-8111-111111111111",
  certification_name: "Computer Science",
  category_id: "22222222-2222-4222-8222-222222222222",
  category_name: "Data Structures",
  difficulty: "medium",
  question_type: "multiple_choice",
  review_status: "pending",
  publication_status: "draft",
  is_flagged: false,
  has_image: true,
  created_by_id: ownerId,
  last_updated: "2026-11-27T12:00:00Z",
};

const published: AdminQuestionBankItem = { ...draft, review_status: "approved", publication_status: "active" };
const submitted: AdminQuestionBankItem = { ...draft, review_status: "submitted" };
const reviewing: AdminQuestionBankItem = { ...draft, review_status: "in_review" };
const rejected: AdminQuestionBankItem = { ...draft, review_status: "rejected", publication_status: "inactive" };
const retired: AdminQuestionBankItem = { ...published, publication_status: "retired" };
const approvedDraft: AdminQuestionBankItem = { ...draft, review_status: "approved" };

const cases: { label: string; question: AdminQuestionBankItem; admin: boolean; owner: boolean }[] = [
  { label: "Draft", question: draft, admin: true, owner: true },
  { label: "Published", question: published, admin: true, owner: false },
  { label: "Submitted", question: submitted, admin: false, owner: false },
  { label: "In Review", question: reviewing, admin: false, owner: false },
  { label: "Rejected", question: rejected, admin: false, owner: false },
  { label: "Retired", question: retired, admin: false, owner: false },
  { label: "Approved Draft", question: approvedDraft, admin: false, owner: false },
  { label: "Inactive", question: { ...draft, publication_status: "inactive" }, admin: false, owner: false },
];

function results(overrides: Partial<Parameters<typeof QuestionBankResults>[0]> = {}) {
  const props = {
    items: [draft], totalCount: 1, page: 1, pageSize: 50, onPageChange: vi.fn(),
    role: "administrator", userId: ownerId, hasFilters: false, onClearFilters: vi.fn(), ...overrides,
  };
  return { props, ...render(<QuestionBankResults {...props} />) };
}

afterEach(cleanup);

describe("Question Bank presentation and permitted actions", () => {
  it.each(cases)("labels $label and matches detail-page Edit restrictions", ({ question, label, admin, owner }) => {
    expect(questionBankStatus(question)).toBe(label);
    expect(canEditBankQuestion(question, "administrator", null)).toBe(admin);
    expect(canEditBankQuestion(question, "contributor", ownerId)).toBe(owner);
    expect(canEditBankQuestion(question, "contributor", "another-user")).toBe(false);
    expect(canEditBankQuestion(question, "learner", ownerId)).toBe(false);
    expect(canEditBankQuestion(question, null, ownerId)).toBe(false);
  });

  it("renders a single responsive row with complete metadata and explicit links", () => {
    results();
    const table = screen.getByRole("table", { name: "Question Bank results" });
    const row = within(table).getByRole("row", { name: /What is a queue/ });
    for (const text of ["Q-33333333", "What is a queue?", "Computer Science", "Data Structures", "MCQ", "medium", "Draft", "Image"]) {
      expect(within(row).getByText(text, { exact: true })).toBeTruthy();
    }
    expect(within(row).getByRole("link", { name: "View Q-33333333" }).getAttribute("href")).toBe(`/admin/questions/${draft.question_id}`);
    expect(within(row).getByRole("link", { name: "Edit Q-33333333" }).getAttribute("href")).toBe(`/admin/questions/${draft.question_id}/edit`);
    expect(within(table).getAllByRole("link", { name: "View Q-33333333" })).toHaveLength(1);
  });

  it("keeps rejected and retired questions viewable but never editable", () => {
    results({ items: [rejected, { ...retired, question_id: "77777777-7777-4777-8777-777777777777" }], totalCount: 2 });
    expect(screen.getAllByRole("link", { name: /^View Q-/ })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^Edit Q-/ })).toBeNull();
  });

  it("describes a published administrator edit as a draft revision", () => {
    results({ items: [published] });
    expect(screen.getByRole("link", { name: "Edit Q-33333333" }).getAttribute("title")).toBe("Create a draft revision");
  });

  it("keeps pagination boundaries and focuses on server-sized ranges", async () => {
    const user = userEvent.setup();
    const { props, rerender } = results({ totalCount: 76 });
    expect(screen.getByText("Showing 1–50 of 76 questions")).toBeTruthy();
    const previous = screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    await user.click(next);
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    rerender(<QuestionBankResults {...props} page={2} />);
    expect(screen.getByText("Showing 51–76 of 76 questions")).toBeTruthy();
    expect(next.disabled).toBe(true);
    await user.click(previous);
    expect(props.onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("offers filter recovery on an empty result without inventing questions", async () => {
    const { props } = results({ items: [], totalCount: 0, hasFilters: true });
    expect(screen.getByText("No questions match the current filters.")).toBeTruthy();
    expect(screen.getByText("Showing 0–0 of 0 questions")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(props.onClearFilters).toHaveBeenCalledOnce();
  });
});
