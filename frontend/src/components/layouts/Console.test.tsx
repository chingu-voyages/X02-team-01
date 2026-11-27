import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import Console from "./Console";
import { useAuth, type UserRole } from "@/features/auth/AuthProvider";

const { mockUsePathname, mockLogout, mockReplace } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockLogout: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    className,
  }: {
    href: string;
    children: ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

function setAuthState(
  role: UserRole | null,
  token: string | null = "test-token",
) {
  vi.mocked(useAuth).mockReturnValue({
    token,
    role,
    ready: true,
    setToken: vi.fn(),
    logout: mockLogout,
  } as ReturnType<typeof useAuth>);
}

describe("Console layout shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/categories");
    setAuthState("learner");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders only children when the user is unauthenticated", () => {
    setAuthState(null, null);

    render(
      <Console>
        <div>Page Content</div>
      </Console>,
    );

    expect(screen.getByText("Page Content")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Main navigation" }),
    ).toBeNull();
  });

  it.each(["/login", "/register"])(
    "bypasses the console shell on %s even if a token exists",
    (publicPath) => {
      mockUsePathname.mockReturnValue(publicPath);
      setAuthState("administrator", "test-token");

      render(
        <Console>
          <div>Auth Form</div>
        </Console>,
      );

      expect(screen.getByText("Auth Form")).toBeTruthy();
      expect(
        screen.queryByRole("navigation", { name: "Main navigation" }),
      ).toBeNull();
    },
  );

  it("renders only learner-permitted sections and items for learners", () => {
    setAuthState("learner");

    render(
      <Console>
        <div>Learner View</div>
      </Console>,
    );

    expect(screen.getAllByText("LEARNER CONSOLE").length).toBeGreaterThan(0);
    expect(screen.getByText("CONTENT MANAGEMENT")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Practice Exams" })).toBeTruthy();
    expect(screen.getByText("ACCOUNT")).toBeTruthy();

    // Admin & Contributor sections/items must be hidden
    expect(screen.queryByText("OVERVIEW")).toBeNull();
    expect(screen.queryByText("USER MANAGEMENT")).toBeNull();
    expect(screen.queryByText("REPORTING")).toBeNull();
    expect(screen.queryByText("Question Bank")).toBeNull();
    expect(screen.queryByText("Certifications & Categories")).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage Exams" })).toBeNull();
    expect(screen.queryByText("Users & Access")).toBeNull();
  });

  it("renders contributor items while hiding admin-only routes", () => {
    setAuthState("contributor");

    render(
      <Console>
        <div>Contributor View</div>
      </Console>,
    );

    expect(screen.getAllByText("CONTRIBUTOR CONSOLE").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("OVERVIEW")).toBeTruthy();
    expect(screen.getByText("REPORTING")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Question Bank" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Practice Exams" })).toBeTruthy();

    // Admin-only routes remain hidden
    expect(screen.queryByText("USER MANAGEMENT")).toBeNull();
    expect(screen.queryByText("Users & Access")).toBeNull();
    expect(screen.queryByText("Certifications & Categories")).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage Exams" })).toBeNull();
  });

  it("renders all sections and admin routes for administrators", () => {
    setAuthState("administrator");

    render(
      <Console>
        <div>Admin View</div>
      </Console>,
    );

    expect(screen.getAllByText("ADMIN CONSOLE").length).toBeGreaterThan(0);
    expect(screen.getByText("OVERVIEW")).toBeTruthy();
    expect(screen.getByText("CONTENT MANAGEMENT")).toBeTruthy();
    expect(screen.getByText("USER MANAGEMENT")).toBeTruthy();
    expect(screen.getByText("REPORTING")).toBeTruthy();

    expect(screen.getByRole("link", { name: "Question Bank" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Certifications & Categories" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Practice Exams" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Manage Exams" }).getAttribute("href"),
    ).toBe("/admin/practice-exams");
    expect(
      screen.getByRole("link", { name: "Practice Exams" }).getAttribute("href"),
    ).toBe("/categories");
    expect(screen.getByRole("link", { name: "Users & Access" })).toBeTruthy();
  });

  it("highlights the active navigation link matching the current pathname", () => {
    mockUsePathname.mockReturnValue("/admin/questions/new");
    setAuthState("administrator");

    render(
      <Console>
        <div>New Question</div>
      </Console>,
    );

    const activeLink = screen.getByRole("link", { name: "Question Bank" });
    const inactiveLink = screen.getByRole("link", { name: "Users & Access" });

    expect(activeLink.className).toContain("bg-brand-accent");
    expect(inactiveLink.className).not.toContain("bg-brand-accent");
  });

  it("highlights Manage Exams without highlighting the learner exam link", () => {
    mockUsePathname.mockReturnValue("/admin/practice-exams");
    setAuthState("administrator");

    render(
      <Console>
        <div>Exam Management</div>
      </Console>,
    );

    const manageLink = screen.getByRole("link", { name: "Manage Exams" });
    const practiceLink = screen.getByRole("link", { name: "Practice Exams" });

    expect(manageLink.className).toContain("bg-brand-accent");
    expect(practiceLink.className).not.toContain("bg-brand-accent");
  });

  it.each(["administrator", "contributor", "learner"] as const)(
    "applies Manage Exams permissions in the mobile drawer for %s",
    async (role) => {
      const user = userEvent.setup();
      setAuthState(role);

      render(
        <Console>
          <div>Page Content</div>
        </Console>,
      );

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );

      const links = screen.queryAllByRole("link", { name: "Manage Exams" });
      expect(links).toHaveLength(role === "administrator" ? 2 : 0);
      for (const link of links) {
        expect(link.getAttribute("href")).toBe("/admin/practice-exams");
      }
    },
  );

  it("marks upcoming sprint features and My Account as disabled", () => {
    setAuthState("administrator");

    render(
      <Console>
        <div>Admin View</div>
      </Console>,
    );

    const dashboardItem = screen.getByText("Dashboard").closest("div");
    const myAccountItem = screen.getByText("My Account").closest("div");

    expect(dashboardItem?.getAttribute("aria-disabled")).toBe("true");
    expect(myAccountItem?.getAttribute("aria-disabled")).toBe("true");
  });

  it("calls logout when clicking Log Out", async () => {
    const user = userEvent.setup();
    setAuthState("learner");

    render(
      <Console>
        <div>Learner View</div>
      </Console>,
    );

    await user.click(screen.getByRole("button", { name: "Log Out" }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the mobile navigation drawer", async () => {
    const user = userEvent.setup();
    setAuthState("learner");

    render(
      <Console>
        <div>Learner View</div>
      </Console>,
    );

    const openButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    expect(openButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(openButton);

    const closeButton = screen.getByRole("button", {
      name: "Close navigation menu",
    });
    expect(closeButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getAllByRole("navigation", { name: "Main navigation" }),
    ).toHaveLength(2);

    await user.click(closeButton);
    expect(
      screen
        .getByRole("button", { name: "Open navigation menu" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});


describe("Enrollment-only navigation", () => {
  afterEach(cleanup);

  it("hides administrator navigation and redirects a protected route", () => {
    mockUsePathname.mockReturnValue("/admin/users");
    const claims = btoa(JSON.stringify({ role: "administrator", mfa: "enrollment" }));
    setAuthState("administrator", `header.${claims}.signature`);
    render(<Console><div>Privileged content</div></Console>);
    expect(screen.queryByText("Privileged content")).toBeNull();
    expect(screen.queryByRole("link", { name: "Users & Access" })).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith("/account/security");
  });

  it("allows the enrollment screen without an administrator sidebar", () => {
    mockUsePathname.mockReturnValue("/account/security");
    const claims = btoa(JSON.stringify({ role: "administrator", mfa: "enrollment" }));
    setAuthState("administrator", `header.${claims}.signature`);
    render(<Console><div>Enrollment content</div></Console>);
    expect(screen.getByText("Enrollment content")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  });
});
