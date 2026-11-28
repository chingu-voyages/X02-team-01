import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExamReviewScreen from "./ExamReviewScreen";
import { ApiError } from "@/lib/api-client";
import { getCompletedExamReview } from "@/lib/exam-review";
import { reviewStatuses, type CompletedExamReview } from "@/types/exam-review.types";

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({ useAuth: () => ({ logout }) }));
vi.mock("@/lib/exam-review", () => ({ getCompletedExamReview: vi.fn() }));
const load = vi.mocked(getCompletedExamReview);
const attemptId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const labels = ["Correct", "Incorrect", "Unanswered", "Pending Grading", "Manually graded", "Not graded"];
const result: CompletedExamReview = {
  attempt_id: attemptId,
  status: "submitted",
  question_count: 6,
  questions: reviewStatuses.map((status, index) => ({
    question_version_id: `33333333-3333-4333-8333-33333333333${index}`,
    position: index + 1,
    status,
    preview: `Original preview ${index + 1}`,
  })),
};

function show(token = "token") {
  return render(<ExamReviewScreen attemptId={attemptId} accessToken={token} />);
}

function backLink() {
  return screen.getByRole("link", { name: "Back to Results" });
}

function list() {
  return screen.getByRole("list", { name: "Completed exam questions" });
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe("ExamReviewScreen", () => {
  it("keeps the back link available while loading and renders all six statuses in saved order", async () => {
    load.mockResolvedValueOnce(result);
    show();
    expect(screen.getByRole("status").textContent).toBe("Loading exam review...");
    expect(backLink().getAttribute("href")).toBe(`/exams/${attemptId}/results`);
    const rows = within(await screen.findByRole("list", { name: "Completed exam questions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    rows.forEach((row, index) => {
      expect(within(row).getByRole("heading", { name: `Question ${index + 1}` })).toBeTruthy();
      expect(within(row).getByText(labels[index])).toBeTruthy();
      expect(within(row).getByText(`Original preview ${index + 1}`)).toBeTruthy();
      const link = within(row).getByRole("link", { name: `Review question ${index + 1}: ${labels[index]}` });
      expect(link.getAttribute("href")).toBe(`/exams/${attemptId}/review/questions/${result.questions[index].question_version_id}`);
    });
    expect(screen.getByRole("status").textContent).toBe("Showing 6 of 6 questions");
    // JHEP-72 enables the real detail links but never adds answer controls.
    expect(within(list()).getAllByRole("link")).toHaveLength(6);
    expect(within(list()).queryAllByRole("button")).toHaveLength(0);
    expect(within(list()).queryAllByRole("radio")).toHaveLength(0);
    expect(within(list()).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("filters by status without renumbering, including empty filter results and reset", async () => {
    const user = userEvent.setup();
    load.mockResolvedValueOnce({ ...result, question_count: 2, questions: result.questions.slice(0, 2) });
    show();
    const filter = await screen.findByRole("combobox", { name: "Filter by status" });
    await user.tab();
    expect(document.activeElement).toBe(backLink());
    await user.tab();
    expect(document.activeElement).toBe(filter);
    await user.selectOptions(filter, "incorrect");
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list()).getByRole("heading", { name: "Question 2" })).toBeTruthy();
    const link = within(list()).getByRole("link", { name: "Review question 2: Incorrect" });
    expect(link.getAttribute("href")).toBe(`/exams/${attemptId}/review/questions/${result.questions[1].question_version_id}`);
    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 2 questions");
    await user.selectOptions(filter, "pending_manual_grading");
    expect(screen.getByText("No questions match this status.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show all questions" }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("handles an empty attempt and retains return navigation", async () => {
    load.mockResolvedValueOnce({ ...result, questions: [] });
    show();
    expect(await screen.findByRole("heading", { name: "No questions available" })).toBeTruthy();
    expect(backLink().getAttribute("href")).toBe(`/exams/${attemptId}/results`);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it.each([403, 404, 409])("does not disclose content or offer futile retries for HTTP %i", async (status) => {
    load.mockRejectedValueOnce(new ApiError(status, "Sensitive server detail"));
    show();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(status === 409 ? "Finish the practice exam before reviewing its answers." : "This exam review is unavailable.");
    expect(screen.queryByText("Sensitive server detail")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry loading review" })).toBeNull();
    expect(backLink()).toBeTruthy();
  });

  it("retries transient failures for the same attempt and token", async () => {
    const user = userEvent.setup();
    load.mockRejectedValueOnce(new Error("Network failure")).mockResolvedValueOnce(result);
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry loading review" }));
    expect(await screen.findByRole("list", { name: "Completed exam questions" })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    for (const [id, token] of load.mock.calls) {
      expect(id).toBe(attemptId);
      expect(token).toBe("token");
    }
  });

  it("logs out when authentication expires and never shows question content", async () => {
    load.mockRejectedValueOnce(new ApiError(401, "Expired"));
    show();
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("immediately removes previously loaded content when attempt or token changes", async () => {
    load.mockResolvedValueOnce(result).mockImplementationOnce(() => new Promise(() => {}));
    const view = show();
    expect(await screen.findByRole("list", { name: "Completed exam questions" })).toBeTruthy();
    view.rerender(<ExamReviewScreen attemptId={attemptId} accessToken="new-token" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading exam review...");
    expect(load.mock.calls[0][2]?.aborted).toBe(true);
  });

  it("ignores a delayed response from a previous attempt", async () => {
    let resolvePrevious!: (data: CompletedExamReview) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    load.mockResolvedValueOnce({ ...result, attempt_id: otherId, question_count: 1, questions: [{ ...result.questions[0], preview: "Other attempt preview" }] });
    const view = show();
    view.rerender(<ExamReviewScreen attemptId={otherId} accessToken="token" />);
    expect(await screen.findByText("Other attempt preview")).toBeTruthy();
    await act(async () => resolvePrevious(result));
    expect(screen.queryByText("Original preview 1")).toBeNull();
    expect(screen.getByText("Other attempt preview")).toBeTruthy();
    expect(backLink().getAttribute("href")).toBe(`/exams/${otherId}/results`);
  });
});
