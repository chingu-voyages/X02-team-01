import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamSelectionStatus from "./ExamSelectionStatus";

describe("ExamSelectionStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders loading status message when loading", () => {
    render(
      <ExamSelectionStatus
        loadStatus="loading"
        loadError=""
        totalExamCount={0}
        visibleExamCount={0}
        startError=""
        existingAttemptId={null}
        onRetryLoad={vi.fn()}
        onContinueExisting={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Loading practice exams...",
    );
  });

  it("renders load error alert and triggers onRetryLoad when Retry is clicked", async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();

    render(
      <ExamSelectionStatus
        loadStatus="error"
        loadError="Failed to fetch catalog"
        totalExamCount={0}
        visibleExamCount={0}
        startError=""
        existingAttemptId={null}
        onRetryLoad={onRetryLoad}
        onContinueExisting={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Failed to fetch catalog",
    );

    await user.click(
      screen.getByRole("button", { name: "Retry loading practice exams" }),
    );
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it("renders empty catalog and empty filter messages when ready", () => {
    const { rerender } = render(
      <ExamSelectionStatus
        loadStatus="ready"
        loadError=""
        totalExamCount={0}
        visibleExamCount={0}
        startError=""
        existingAttemptId={null}
        onRetryLoad={vi.fn()}
        onContinueExisting={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "No published practice exams are currently available.",
    );

    rerender(
      <ExamSelectionStatus
        loadStatus="ready"
        loadError=""
        totalExamCount={4}
        visibleExamCount={0}
        startError=""
        existingAttemptId={null}
        onRetryLoad={vi.fn()}
        onContinueExisting={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "No published exams match this certification.",
    );
  });

  it("renders startError banner with Continue existing exam action when existingAttemptId is present", async () => {
    const user = userEvent.setup();
    const onContinueExisting = vi.fn();
    const onRetryLoad = vi.fn();

    render(
      <ExamSelectionStatus
        loadStatus="ready"
        loadError=""
        totalExamCount={2}
        visibleExamCount={2}
        startError="You already have an unfinished exam for this certification."
        existingAttemptId="11111111-1111-1111-1111-111111111111"
        onRetryLoad={onRetryLoad}
        onContinueExisting={onContinueExisting}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "You already have an unfinished exam for this certification.",
    );

    await user.click(
      screen.getByRole("button", { name: "Continue existing exam" }),
    );
    expect(onContinueExisting).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Reload exams" }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});