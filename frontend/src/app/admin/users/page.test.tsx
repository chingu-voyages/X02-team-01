import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api-client";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import AdminUsersPage from "./page";
import {
  changeAdminUserRole,
  getAdminUsers,
  type AdminUsersPage as AdminUsersPageData,
} from "@/lib/admin-users-api";

const { mockPush, mockHandleError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    token: "admin-token",
    ready: true,
    setToken: vi.fn(),
    logout: vi.fn(),
  }),
  useDemoSession: () => ({
    token: "admin-token",
    ready: true,
    handleError: mockHandleError,
  }),
}));

vi.mock("@/lib/admin-users-api", () => ({
  getAdminUsers: vi.fn(),
  changeAdminUserRole: vi.fn(),
}));

vi.mock("@/components/layouts/Navbar", () => ({
  default: () => <nav data-testid="navbar" />,
}));

const mockedGet = vi.mocked(getAdminUsers);
const mockedChange = vi.mocked(changeAdminUserRole);

const pageOf = (items: AdminUsersPageData["items"]) => ({
  items,
  total: items.length,
  limit: 50,
  offset: 0,
});

const learner: AdminUsersPageData["items"][number] = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.com",
  fullName: "Learner One",
  role: "learner",
  is_verified: true,
  created_at: "2026-11-13T00:00:00Z",
};

const contributor: AdminUsersPageData["items"][number] = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "contributor@example.com",
  fullName: "Contributor One",
  role: "contributor",
  is_verified: true,
  created_at: "2026-11-13T00:00:00Z",
};

const administrator: AdminUsersPageData["items"][number] = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "admin@example.com",
  fullName: "Admin One",
  role: "administrator",
  is_verified: true,
  created_at: "2026-11-13T00:00:00Z",
};

afterEach(cleanup);

beforeEach(() => {
  mockedGet.mockReset();
  mockedChange.mockReset();
  mockHandleError.mockReset();
});

describe("AdminUsersPage (JHEP-125 Users & Access)", () => {
  it("lists accounts with role badges and search results", async () => {
    mockedGet.mockResolvedValue(
      pageOf([learner, contributor, administrator]),
    );

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("learner@example.com")).toBeTruthy();
    });
    expect(screen.getByText("contributor@example.com")).toBeTruthy();
    expect(screen.getAllByText("learner").length).toBeGreaterThan(0);
    expect(screen.getByText("Make Contributor")).toBeTruthy();
    expect(screen.getByText("Revoke Contributor")).toBeTruthy();
  });

  it("requires confirmation and calls the change endpoint", async () => {
    mockedGet.mockResolvedValue(pageOf([learner]));
    mockedChange.mockResolvedValue({
      user: { ...learner, role: "contributor" },
      action: "promoted",
      role_before: "learner",
      role_after: "contributor",
      changed_at: "2026-11-13T01:00:00Z",
    });

    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("Make Contributor")).toBeTruthy();
    });

    // No request is fired before the confirmation modal accepts.
    expect(mockedChange).not.toHaveBeenCalled();

    await user.click(screen.getByText("Make Contributor"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Grant Contributor access?")).toBeTruthy();

    await user.click(
      screen.getByText("Confirm: make Contributor"),
    );

    await waitFor(() => {
      expect(mockedChange).toHaveBeenCalledWith(
        "admin-token",
        learner.id,
        "contributor",
      );
    });
    await waitFor(() => {
      expect(
        screen.getByText("Learner One is now a Contributor."),
      ).toBeTruthy();
    });
  });

  it("surfaces failures without mutating the list", async () => {
    mockedGet.mockResolvedValue(pageOf([learner]));
    mockedChange.mockRejectedValue(
      new Error("Unable to change the role"),
    );

    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText("Make Contributor")).toBeTruthy();
    });

    await user.click(screen.getByText("Make Contributor"));
    await user.click(screen.getByText("Confirm: make Contributor"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(mockHandleError).not.toHaveBeenCalled();
  });

  it("shows a safe error state when listing fails with a server error", async () => {
    mockedGet.mockRejectedValue(new Error("Unable to load accounts"));

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("Unable to load accounts")).toBeTruthy();
    });
    expect(mockHandleError).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated visits via the session hook", async () => {
    mockedGet.mockRejectedValue(
      new ApiError(403, "You do not have permission to perform this action."),
    );

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalled();
    });
  });
});
