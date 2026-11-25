import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamSelectionStatus from "./ExamSelectionStatus";

describe("ExamSelectionStatus", () => {
  afterEach(() => cleanup());

  it("renders loading status message when loading", () => {
    render(
      <ExamSelectionStatus
        loadStatus="loading"
        loadError=""
        totalExamCount={0}
        visibleExamCount={0}
        startError=""
        onRetryLoad={vi.fn()}
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
        onRetryLoad={onRetryLoad}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Failed to fetch catalog");
    await user.click(screen.getByRole("button", { name: "Retry loading practice exams" }));
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
        onRetryLoad={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("No published practice exams are currently available.");
    rerender(
      <ExamSelectionStatus
        loadStatus="ready"
        loadError=""
        totalExamCount={4}
        visibleExamCount={0}
        startError=""
        onRetryLoad={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("No published exams match this certification.");
  });

  it("offers reload for a real start error without a global resume action", async () => {
    const user = userEvent.setup();
    const onRetryLoad = vi.fn();
    render(
      <ExamSelectionStatus
        loadStatus="ready"
        loadError=""
        totalExamCount={2}
        visibleExamCount={2}
        startError="This practice exam is unavailable."
        onRetryLoad={onRetryLoad}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("This practice exam is unavailable.");
    expect(screen.queryByRole("button", { name: /Continue/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reload exams" }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});
