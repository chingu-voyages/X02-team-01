import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuestionReviewActions from "./QuestionReviewActions";
import { ApiError } from "@/lib/api-client";
import { getManagedQuestion, publishManagedQuestion, rejectManagedQuestion, requestQuestionChanges, retireManagedQuestion, startQuestionReview, submitManagedQuestion } from "@/lib/admin-question-api";
import type { AdminQuestionDetail } from "@/types/admin-question-api.types";

vi.mock("@/lib/admin-question-api", () => ({
  getManagedQuestion: vi.fn(), publishManagedQuestion: vi.fn(), rejectManagedQuestion: vi.fn(),
  requestQuestionChanges: vi.fn(), retireManagedQuestion: vi.fn(), startQuestionReview: vi.fn(), submitManagedQuestion: vi.fn(),
}));

const draft: AdminQuestionDetail = {
  question_id: "question-1", question_version_id: "version-1", version_number: 1,
  certification_id: "cert-1", certification_name: "Science", category_id: "category-1", category_name: "Fundamentals",
  difficulty: "easy", question_text: "Which option is correct?", question_type: "multiple_choice",
  allows_multiple_answers: false, explanation: "Option A is correct.", review_status: "pending", publication_status: "draft",
  review_note: null, is_flagged: false, created_by_id: "owner", submitted_by_id: "owner", last_updated: "2026-11-27T12:00:00Z",
  options: [{ position: 1, option_text: "A", is_correct: true }, { position: 2, option_text: "B", is_correct: false }], expected_answer: null, images: [],
};
const submitted: AdminQuestionDetail = { ...draft, review_status: "submitted" };
const reviewing: AdminQuestionDetail = { ...draft, review_status: "in_review" };
const published: AdminQuestionDetail = { ...draft, review_status: "approved", publication_status: "active" };
const rejected: AdminQuestionDetail = { ...draft, review_status: "rejected", publication_status: "inactive", review_note: "Needs a different source." };
const unauthorized = vi.fn();
const reload = vi.fn();
const onUpdated = vi.fn();

type Role = "administrator" | "contributor" | "learner" | null;
function Harness({ initial, role, userId }: { initial: AdminQuestionDetail; role: Role; userId: string | null }) {
  const [question, setQuestion] = useState(initial);
  return <QuestionReviewActions question={question} role={role} userId={userId} token="test-token" onUnauthorized={unauthorized} onReload={reload} onUpdated={(updated) => { onUpdated(updated); setQuestion(updated); }} />;
}
function setup(initial = draft, role: Role = "administrator", userId: string | null = "owner") {
  render(<Harness initial={initial} role={role} userId={userId} />);
  return userEvent.setup();
}
const button = (name: string) => screen.getByRole("button", { name });
const dialog = () => within(screen.getByRole("dialog"));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("JHEP-207 role-specific question review actions", () => {
  it("allows an administrator to publish their draft without a contributor submission or invalid reject action", () => {
    setup();
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
    expect(button("Approve & Publish")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit for Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
  it("lets an owning contributor submit, then shows the confirmed submitted state", async () => {
    vi.mocked(submitManagedQuestion).mockResolvedValue(submitted);
    const user = setup(draft, "contributor");
    expect(screen.queryByRole("button", { name: "Approve & Publish" })).toBeNull();
    await user.click(button("Submit for Review"));
    expect(await screen.findByText("Question submitted for review.")).toBeTruthy();
    expect(submitManagedQuestion).toHaveBeenCalledWith("test-token", draft.question_id);
    expect(screen.queryByRole("button", { name: "Submit for Review" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });
  it.each([["contributor", "other"], ["learner", "owner"], [null, null]] as const)("does not expose mutation actions for role %s / user %s", (role, userId) => {
    setup(draft, role, userId);
    expect(screen.queryByRole("group", { name: "Question actions" })).toBeNull();
  });
  it("requires an explicit Start Review before an administrator can approve or return a contributor submission", async () => {
    vi.mocked(startQuestionReview).mockResolvedValue(reviewing);
    const user = setup(submitted);
    expect(screen.queryByRole("button", { name: "Approve & Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request Changes" })).toBeNull();
    await user.click(button("Start Review"));
    expect(await screen.findByRole("button", { name: "Approve & Publish" })).toBeTruthy();
    expect(button("Request Changes")).toBeTruthy();
    expect(button("Reject")).toBeTruthy();
    expect(startQuestionReview).toHaveBeenCalledWith("test-token", draft.question_id);
  });
  it("keeps review decisions unavailable to contributors during review", () => {
    setup(reviewing, "contributor");
    expect(screen.queryByRole("group", { name: "Question actions" })).toBeNull();
  });
  it("cancels a publication confirmation without a request and restores focus", async () => {
    const user = setup();
    const trigger = button("Approve & Publish");
    await user.click(trigger);
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(publishManagedQuestion).not.toHaveBeenCalled();
  });
  it.each([draft, reviewing])("publishes the confirmed version from $review_status", async (question) => {
    vi.mocked(publishManagedQuestion).mockResolvedValue(published);
    const user = setup(question);
    await user.click(button("Approve & Publish"));
    expect(publishManagedQuestion).not.toHaveBeenCalled();
    await user.click(dialog().getByRole("button", { name: "Confirm publish" }));
    expect(await screen.findByText("Question approved and published.")).toBeTruthy();
    expect(button("Retire")).toBeTruthy();
    expect(publishManagedQuestion).toHaveBeenCalledTimes(1);
  });
  it("requires feedback before requesting changes and returns to draft", async () => {
    vi.mocked(requestQuestionChanges).mockResolvedValue({ ...draft, review_note: "Clarify the explanation." });
    const user = setup(reviewing);
    await user.click(button("Request Changes"));
    await user.click(dialog().getByRole("button", { name: "Send feedback" }));
    expect(dialog().getByRole("alert").textContent).toMatch(/review reason/);
    const input = dialog().getByLabelText("Review reason (required)");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(requestQuestionChanges).not.toHaveBeenCalled();
    await user.type(input, "  Clarify the explanation.  ");
    await user.click(dialog().getByRole("button", { name: "Send feedback" }));
    expect(await screen.findByText("Changes requested. The question has returned to draft.")).toBeTruthy();
    expect(requestQuestionChanges).toHaveBeenCalledWith("test-token", draft.question_id, "Clarify the explanation.");
    expect(screen.getByText("Clarify the explanation.")).toBeTruthy();
  });
  it("lets the contributor edit and resubmit a returned draft with visible feedback", () => {
    setup({ ...draft, review_note: "Clarify the explanation." }, "contributor");
    expect(screen.getByText("Clarify the explanation.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
    expect(button("Submit for Review")).toBeTruthy();
  });
  it("retains rejected questions as inactive and removes edit/publish/submit actions", async () => {
    vi.mocked(rejectManagedQuestion).mockResolvedValue(rejected);
    const user = setup(reviewing);
    await user.click(button("Reject"));
    await user.type(dialog().getByLabelText("Review reason (required)"), rejected.review_note!);
    await user.click(dialog().getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByText("Question rejected and retained as inactive.")).toBeTruthy();
    expect(screen.getByText(rejected.review_note!)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Question actions" })).toBeNull();
  });
  it("blocks duplicate requests while publication is in flight", async () => {
    let complete!: (value: AdminQuestionDetail) => void;
    vi.mocked(publishManagedQuestion).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const user = setup();
    await user.click(button("Approve & Publish"));
    const confirm = dialog().getByRole("button", { name: "Confirm publish" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(publishManagedQuestion).toHaveBeenCalledTimes(1);
    expect(dialog().getByRole("button", { name: "Publishing..." }).matches(":disabled")).toBe(true);
    await act(async () => complete(published));
    expect(await screen.findByText("Question approved and published.")).toBeTruthy();
  });
  it("displays a conflict inside the dialog and requires a refresh instead of guessing the outcome", async () => {
    vi.mocked(publishManagedQuestion).mockRejectedValue(new ApiError(409, "Conflict"));
    const user = setup();
    await user.click(button("Approve & Publish"));
    await user.click(dialog().getByRole("button", { name: "Confirm publish" }));
    expect((await dialog().findByRole("alert")).textContent).toMatch(/Reload its details/);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(dialog().queryByRole("button", { name: "Confirm publish" })).toBeNull();
    await user.click(dialog().getByRole("button", { name: "Reload details" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("preserves entered review feedback after the server rejects validation", async () => {
    vi.mocked(requestQuestionChanges).mockRejectedValue(new ApiError(422, "Invalid"));
    const user = setup(reviewing);
    await user.click(button("Request Changes"));
    await user.type(dialog().getByLabelText("Review reason (required)"), "Feedback text");
    await user.click(dialog().getByRole("button", { name: "Send feedback" }));
    expect(await dialog().findByRole("alert")).toBeTruthy();
    expect((dialog().getByLabelText("Review reason (required)") as HTMLTextAreaElement).value).toBe("Feedback text");
    expect(onUpdated).not.toHaveBeenCalled();
  });
  it("uses the shared session handler on expiration", async () => {
    const error = new ApiError(401, "Expired");
    vi.mocked(startQuestionReview).mockRejectedValue(error);
    const user = setup(submitted);
    await user.click(button("Start Review"));
    await waitFor(() => expect(unauthorized).toHaveBeenCalledWith(error));
    expect(onUpdated).not.toHaveBeenCalled();
  });
  it("retains the existing retirement path with confirmation and refreshed server detail", async () => {
    vi.mocked(retireManagedQuestion).mockResolvedValue({ question_id: draft.question_id, retired_version_ids: [draft.question_version_id], publication_status: "retired", already_retired: false });
    vi.mocked(getManagedQuestion).mockResolvedValue({ ...published, publication_status: "retired" });
    const user = setup(published);
    await user.click(button("Retire"));
    await user.click(dialog().getByRole("button", { name: "Confirm retirement" }));
    expect(await screen.findByText("Question retired.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Question actions" })).toBeNull();
  });
});
