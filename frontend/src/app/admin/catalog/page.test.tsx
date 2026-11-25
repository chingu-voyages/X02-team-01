import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminCatalogPage from "./page";
import { ApiError } from "@/lib/api-client";
import {
  getAdminCategories,
  getAdminCertifications,
} from "@/lib/admin-catalog-api";
import type {
  AdminCategory,
  AdminCertification,
} from "@/types/admin-catalog-api.types";

const auth = vi.hoisted(() => ({
  role: "administrator" as "administrator" | "contributor" | "learner",
  handleError: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "test-token",
    ready: true,
    role: auth.role,
    handleError: auth.handleError,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/admin-catalog-api", () => ({
  getAdminCategories: vi.fn(),
  getAdminCertifications: vi.fn(),
  createAdminCategory: vi.fn(),
  createAdminCertification: vi.fn(),
  setAdminCategoryPublication: vi.fn(),
  setAdminCertificationPublication: vi.fn(),
}));

const certification: AdminCertification = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Computer Science",
  code: "CS-100",
  passing_threshold_pct: 70,
  feedback_mode: "immediate",
  is_published: true,
};

const category: AdminCategory = {
  id: "33333333-3333-4333-8333-333333333333",
  certification_id: certification.id,
  certification_name: certification.name,
  name: "Programming Fundamentals",
  is_published: true,
};

const mockCertifications = vi.mocked(getAdminCertifications);
const mockCategories = vi.mocked(getAdminCategories);

beforeEach(() => {
  auth.role = "administrator";
  auth.handleError.mockReset();
  mockCertifications.mockReset();
  mockCategories.mockReset();
  mockCertifications.mockResolvedValue([certification]);
  mockCategories.mockResolvedValue([category]);
});

afterEach(cleanup);

describe("JHEP-201 Catalog practice exam publishing guidance", () => {
  it("explains the separate publication requirement and links to Manage Exams", async () => {
    render(<AdminCatalogPage />);

    const guidance = await screen.findByRole("region", {
      name: "Practice exam availability",
    });

    expect(
      within(guidance).getByText(/does not automatically publish a practice exam/i),
    ).toBeVisible();
    expect(
      within(guidance).getByText(/after enough eligible questions are available/i),
    ).toBeVisible();
    expect(
      within(guidance).getByRole("link", { name: "Open Manage Exams" }),
    ).toHaveAttribute("href", "/admin/practice-exams");
    expect(screen.getByRole("heading", { name: "Computer Science" })).toBeVisible();
    expect(screen.getByText("Published category")).toBeVisible();
    expect(screen.queryByText(/Learners only see categories when/i)).toBeNull();
  });

  it("shows the guidance even when the administrator catalog is empty", async () => {
    mockCertifications.mockResolvedValue([]);
    mockCategories.mockResolvedValue([]);
    render(<AdminCatalogPage />);

    expect(await screen.findByText(/No certifications exist yet/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Manage Exams" })).toHaveAttribute(
      "href",
      "/admin/practice-exams",
    );
  });

  it.each(["contributor", "learner"] as const)(
    "does not expose the administrator shortcut to a %s",
    async (role) => {
      auth.role = role;
      render(<AdminCatalogPage />);

      // Even if the catalog data is available, the new management shortcut
      // must remain administrator-only.
      await screen.findByRole("heading", { name: "Computer Science" });
      expect(screen.queryByRole("link", { name: "Open Manage Exams" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Practice exam availability" })).toBeNull();
    },
  );

  it("does not display the shortcut when loading the catalog fails", async () => {
    mockCertifications.mockRejectedValue(new ApiError(403, "Forbidden"));
    render(<AdminCatalogPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load the admin catalog.",
    );
    expect(screen.queryByRole("link", { name: "Open Manage Exams" })).toBeNull();
  });
});
