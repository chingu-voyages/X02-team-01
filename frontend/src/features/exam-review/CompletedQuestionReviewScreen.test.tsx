import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompletedQuestionReviewScreen from "./CompletedQuestionReviewScreen";
import { ApiError } from "@/lib/api-client";
import { getCompletedQuestionReview, questionReviewHref } from "@/lib/exam-question-review";
import { getCompletedExamReview } from "@/lib/exam-review";
import { detail, attemptId, versionId, otherId } from "@/lib/exam-question-review.fixture";
import type { CompletedQuestionReview } from "@/types/exam-question-review.types";

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ logout }) }));
vi.mock("@/lib/exam-question-review", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/exam-question-review")>(), getCompletedQuestionReview: vi.fn() }));
vi.mock("@/lib/exam-review", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/exam-review")>(), getCompletedExamReview: vi.fn() }));
const load = vi.mocked(getCompletedQuestionReview);
const loadList = vi.mocked(getCompletedExamReview);
const list = { attempt_id: attemptId, status: "submitted" as const, question_count: 2, questions: [
  { question_version_id: versionId, position: 1, status: "incorrect" as const, preview: "First" },
  { question_version_id: otherId, position: 2, status: "correct" as const, preview: "Second" },
] };
const show = () => render(<CompletedQuestionReviewScreen attemptId={attemptId} questionVersionId={versionId} accessToken="token" />);
const ready = () => screen.findByRole("heading", { name: "Question 1 of 2" });
const options = () => screen.getByRole("list", { name: "Recorded answer options" });

beforeEach(() => { vi.resetAllMocks(); loadList.mockResolvedValue(list); });
afterEach(cleanup);

describe("CompletedQuestionReviewScreen", () => {
  it("shows recorded strict-match outcome, chosen and missed options, explanation and no edit controls", async () => {
    load.mockResolvedValue(detail);
    show();
    expect(screen.getByRole("status").textContent).toBe("Loading question review...");
    expect(screen.getByRole("link", { name: "Back to questions" }).getAttribute("href")).toBe(`/exams/${attemptId}/review`);
    await ready();
    expect(screen.getByText("Incorrect", { exact: true })).toBeTruthy();
    expect(screen.getByRole("heading", { name: detail.question_text })).toBeTruthy();
    const rows = within(options()).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Your answer")).toBeTruthy();
    expect(within(rows[0]).getByText("Correct answer", { exact: true })).toBeTruthy();
    expect(within(rows[1]).getByText("Your answer")).toBeTruthy();
    expect(within(rows[1]).getByText("Incorrect selection")).toBeTruthy();
    expect(within(rows[2]).getByText("Correct answer · Not selected")).toBeTruthy();
    expect(within(rows[2]).queryByText("Your answer")).toBeNull();
    expect(screen.getByRole("heading", { name: "Explanation" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: "Previous question" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next question" }).getAttribute("href")).toBe(questionReviewHref(attemptId, otherId));
  });
  it("renders a single selected correct answer and reuses image fallback", async () => {
    load.mockResolvedValue({ ...detail, allows_multiple_answers: false, question_status: "correct",
      correct_option_ids: [detail.options[0].id], submitted_response: { ...detail.submitted_response!, selected_option_ids: [detail.options[0].id] },
      grading: { outcome: "correct", points_earned: 1, max_points: 1, feedback: null },
      images: [{ id: otherId, position: 1, alt_text: "Original diagram", media_type: "image/png", url: null }] });
    show(); await ready();
    expect(screen.getByText("Single answer")).toBeTruthy();
    expect(screen.getByText("Correct", { exact: true })).toBeTruthy();
    expect(screen.getByText("Your answer", { exact: true })).toBeTruthy();
    expect(screen.getByText("Correct answer", { exact: true })).toBeTruthy();
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(screen.getByText("Original diagram")).toBeTruthy();
    expect(screen.queryByText("Incorrect selection")).toBeNull();
  });
  it("shows unanswered and missing explanation without inventing a selection", async () => {
    load.mockResolvedValue({ ...detail, question_status: "unanswered", submitted_response: null, explanation: "  " });
    show(); await ready();
    expect(screen.getByText("You did not submit an answer.")).toBeTruthy();
    expect(screen.queryByText("Your answer")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Explanation" })).toBeNull();
    expect(screen.getAllByText("Correct answer · Not selected")).toHaveLength(2);
  });
  it("does not label selections wrong when the answer key is unavailable", async () => {
    load.mockResolvedValue({ ...detail, correct_option_ids: null, question_status: "unavailable" });
    show(); await ready();
    expect(screen.getByText("The correct answer key is unavailable for this question.")).toBeTruthy();
    expect(screen.queryByText("Incorrect selection")).toBeNull();
    expect(screen.getAllByText("Your answer")).toHaveLength(2);
  });
  it.each(["pending_manual_grading", "manually_graded"] as const)("renders written response in %s state", async (status) => {
    load.mockResolvedValue({ ...detail, question_type: "short_answer", allows_multiple_answers: false, question_status: status,
      options: [], correct_option_ids: null, submitted_response: { ...detail.submitted_response!, selected_option_ids: [], text_response: "Réponse 日本語" },
      grading: status === "manually_graded" ? { outcome: status, points_earned: 2, max_points: 3, feedback: "Good work" } : null });
    show(); await ready();
    expect(screen.getByText("Réponse 日本語")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("list", { name: "Recorded answer options" })).toBeNull();
    if (status === "manually_graded") { expect(screen.getByText("Score: 2 / 3")).toBeTruthy(); expect(screen.getByText("Good work")).toBeTruthy(); }
    else expect(screen.getByText(/Your answer is awaiting manual grading/)).toBeTruthy();
  });
  it.each([403, 404, 409, 422])("does not disclose server detail or retry HTTP %s", async (code) => {
    load.mockRejectedValue(new ApiError(code, "PRIVATE ANSWER"));
    show(); await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE ANSWER")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry loading question" })).toBeNull();
    expect(loadList).not.toHaveBeenCalled();
  });
  it("clears expired sessions", async () => {
    load.mockRejectedValue(new ApiError(401, "Expired"));
    show(); await screen.findByRole("alert");
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });
  it("retries a recoverable error", async () => {
    load.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(detail);
    show(); await userEvent.setup().click(await screen.findByRole("button", { name: "Retry loading question" }));
    await ready(); expect(load).toHaveBeenCalledTimes(2);
  });
  it("rejects a mismatched list and keeps return navigation", async () => {
    load.mockResolvedValue(detail); loadList.mockResolvedValue({ ...list, questions: [] });
    show(); await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: detail.question_text })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to questions" })).toBeTruthy();
  });
  it("ignores late responses after changing question and exposes the last-question navigation", async () => {
    let resolveOld!: (value: CompletedQuestionReview) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    load.mockResolvedValueOnce({ ...detail, question_version_id: otherId, position: 2, question_text: "Second question" });
    const view = show();
    view.rerender(<CompletedQuestionReviewScreen attemptId={attemptId} questionVersionId={otherId} accessToken="token" />);
    await screen.findByRole("heading", { name: "Question 2 of 2" });
    await act(async () => resolveOld(detail));
    expect(load.mock.calls[0][3]?.aborted).toBe(true);
    expect(screen.queryByRole("heading", { name: detail.question_text })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous question" }).getAttribute("href")).toBe(questionReviewHref(attemptId, versionId));
    expect(screen.queryByRole("link", { name: "Next question" })).toBeNull();
  });
  it("immediately hides details on token change", async () => {
    load.mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise(() => {}));
    const view = show(); await ready();
    view.rerender(<CompletedQuestionReviewScreen attemptId={attemptId} questionVersionId={versionId} accessToken="different" />);
    expect(screen.queryByRole("heading", { name: detail.question_text })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading question review...");
  });
});
