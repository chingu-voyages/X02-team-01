import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CertificationCard from "./CertificationCard";
import type {
  AdminCategory,
  AdminCertification,
} from "@/types/admin-catalog-api.types";

const mockCertification = {
  id: "cert-1",
  name: "Professional Scrum Master I",
  code: "PSM-I",
  is_published: false,
  passing_threshold_pct: 85,
  feedback_mode: "immediate",
} as AdminCertification;

const mockCategories = [
  {
    id: "cat-1",
    certification_id: "cert-1",
    name: "Scrum Theory",
    is_published: true,
  },
  {
    id: "cat-2",
    certification_id: "cert-1",
    name: "Scrum Events",
    is_published: false,
  },
] as AdminCategory[];

describe("CertificationCard", () => {
  const onToggleCertification = vi.fn();
  const onToggleCategory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders certification details, draft status, and configuration metadata", () => {
    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Professional Scrum Master I" }),
    ).toBeTruthy();
    expect(screen.getByText("PSM-I")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(
      screen.getByText(/Passing score:\s*85%\s*·\s*Feedback:\s*immediate/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish Certification" }),
    ).toBeTruthy();
  });

  it("renders Published state and fallback passing score when not configured", () => {
    const publishedCert = {
      ...mockCertification,
      is_published: true,
      passing_threshold_pct: null,
    } as AdminCertification;

    render(
      <CertificationCard
        certification={publishedCert}
        categories={[]}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByText(/Passing score:\s*Not configured%/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Unpublish Certification" }),
    ).toBeTruthy();
  });

  it("renders an empty state when no categories exist", () => {
    render(
      <CertificationCard
        certification={mockCertification}
        categories={[]}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    expect(screen.getByText("0 total")).toBeTruthy();
    expect(
      screen.getByText(
        "No categories have been created for this certification.",
      ),
    ).toBeTruthy();
  });

  it("renders all categories with their publication status and total count", () => {
    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    expect(screen.getByText("2 total")).toBeTruthy();
    expect(screen.getByText("Scrum Theory")).toBeTruthy();
    expect(screen.getByText("Published category")).toBeTruthy();
    expect(screen.getByText("Scrum Events")).toBeTruthy();
    expect(screen.getByText("Draft category")).toBeTruthy();
  });

  it("calls onToggleCertification when clicking the certification action button", async () => {
    const user = userEvent.setup();

    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Publish Certification" }),
    );

    expect(onToggleCertification).toHaveBeenCalledTimes(1);
    expect(onToggleCertification).toHaveBeenCalledWith(mockCertification);
  });

  it("calls onToggleCategory with the matching category when clicking its toggle button", async () => {
    const user = userEvent.setup();

    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId={null}
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unpublish" }));

    expect(onToggleCategory).toHaveBeenCalledTimes(1);
    expect(onToggleCategory).toHaveBeenCalledWith(mockCategories[0]);
  });

  it("disables the certification button and shows Updating... while certification is updating", () => {
    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId="cert-1"
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    const updatingButton = screen.getByRole("button", { name: "Updating..." });
    expect((updatingButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Unpublish" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("disables only the target category button while that category is updating", () => {
    render(
      <CertificationCard
        certification={mockCertification}
        categories={mockCategories}
        changingPublicationId="cat-2"
        onToggleCertification={onToggleCertification}
        onToggleCategory={onToggleCategory}
      />,
    );

    const updatingButton = screen.getByRole("button", { name: "Updating..." });
    expect((updatingButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Publish Certification",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Unpublish" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});