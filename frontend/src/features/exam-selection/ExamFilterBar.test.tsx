import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ExamFilterBar, { type CertificationOption } from "./ExamFilterBar";

const sampleCertifications: CertificationOption[] = [
  { id: "cert-1", name: "Agile Fundamentals" },
  { id: "cert-2", name: "Scrum Master" },
];

describe("ExamFilterBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks All categories as pressed when selected and shows total and visible counts", () => {
    render(
      <ExamFilterBar
        certifications={sampleCertifications}
        selectedCertificationId="all"
        totalExamCount={5}
        visibleExamCount={5}
        onSelectAll={vi.fn()}
        onSelectCertification={vi.fn()}
      />,
    );

    const allButton = screen.getByRole("button", { name: /All categories/i });
    expect(allButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("5 exams available")).toBeTruthy();
  });

  it("uses singular grammar when only 1 exam is visible and sets aria-pressed to false when filtered", () => {
    render(
      <ExamFilterBar
        certifications={sampleCertifications}
        selectedCertificationId="cert-1"
        totalExamCount={5}
        visibleExamCount={1}
        onSelectAll={vi.fn()}
        onSelectCertification={vi.fn()}
      />,
    );

    const allButton = screen.getByRole("button", { name: /All categories/i });
    expect(allButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("1 exam available")).toBeTruthy();
  });

  it("calls onSelectCertification and onSelectAll when filter controls change", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();
    const onSelectCertification = vi.fn();

    render(
      <ExamFilterBar
        certifications={sampleCertifications}
        selectedCertificationId="all"
        totalExamCount={3}
        visibleExamCount={3}
        onSelectAll={onSelectAll}
        onSelectCertification={onSelectCertification}
      />,
    );

    const select = screen.getByLabelText("Certification or topic");
    await user.selectOptions(select, "cert-2");
    expect(onSelectCertification).toHaveBeenCalledWith("cert-2");

    const allButton = screen.getByRole("button", { name: /All categories/i });
    await user.click(allButton);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});