import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExamSaveStatus from "./ExamSaveStatus";
import type { ExamSaveState } from "@/lib/exam-save-queue";

afterEach(cleanup);
function state(status: ExamSaveState["status"], pendingCount = 0): ExamSaveState {
  return { status, pendingCount, error: status === "error" ? new Error("Network") : null };
}
const errorMessage = "Your latest changes are still on this page.";
describe("ExamSaveStatus", () => {
  it("uses one polite live region and never claims pending changes are saved", () => {
    const props = { errorMessage, canRetry: true, disabled: false, onRetry: vi.fn() };
    const { rerender } = render(<ExamSaveStatus {...props} state={state("idle")} />);
    expect(screen.getByRole("status")).toHaveTextContent("save automatically");
    for (const status of ["pending", "saving"] as const) {
      rerender(<ExamSaveStatus {...props} state={state(status, 1)} />);
      expect(screen.getByRole("status")).toHaveTextContent("Saving progress");
      expect(screen.queryByText("Progress saved", { exact: true })).not.toBeInTheDocument();
    }
    rerender(<ExamSaveStatus {...props} state={state("saved")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Progress saved");
  });
  it("announces a failure and exposes an accessible keyboard retry", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ExamSaveStatus state={state("error", 1)} errorMessage={errorMessage} canRetry disabled={false} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Changes not saved");
    expect(screen.getByRole("alert")).toHaveTextContent(errorMessage);
    await user.tab();
    expect(screen.getByRole("button", { name: "Retry saving" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("does not offer a blind retry on a conflict and disables retry during submission", () => {
    const props = { state: state("error", 1), errorMessage, onRetry: vi.fn() };
    const { rerender } = render(<ExamSaveStatus {...props} canRetry={false} disabled={false} />);
    expect(screen.queryByRole("button", { name: "Retry saving" })).not.toBeInTheDocument();
    rerender(<ExamSaveStatus {...props} canRetry disabled />);
    expect(screen.getByRole("button", { name: "Retry saving" })).toBeDisabled();
  });
});
