import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdminUsersPage from "./AdminUsersPage";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  changeAdminUserRole,
  getAdminUsers,
  type AdminUserItem,
} from "@/lib/admin-users-api";

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: vi.fn(),
}));

vi.mock("@/lib/admin-users-api", () => ({
  getAdminUsers: vi.fn(),
  changeAdminUserRole: vi.fn(),
}));

const mockHandleError = vi.fn();

const sampleUsers: AdminUserItem[] = [
  {
    id: "u-1",
    fullName: "Alan Turing",
    email: "alan@example.com",
    role: "learner",
    is_verified: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "u-2",
    fullName: "Katherine Johnson",
    email: "katherine@example.com",
    role: "contributor",
    is_verified: true,
    created_at: "2026-01-02T00:00:00Z",
  },
];

describe("AdminUsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDemoSession).mockReturnValue({
      token: "admin-token",
      ready: true,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows session status while auth is not ready", () => {
    vi.mocked(useDemoSession).mockReturnValue({
      token: null,
      ready: false,
      handleError: mockHandleError,
    } as unknown as ReturnType<typeof useDemoSession>);

    render(<AdminUsersPage />);

    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(getAdminUsers).not.toHaveBeenCalled();
  });

  it("loads and renders user accounts on mount", async () => {
    vi.mocked(getAdminUsers).mockResolvedValue({
      items: sampleUsers,
      total: 2,
      limit: 20,
      offset: 0,
    });

    render(<AdminUsersPage />);

    expect(await screen.findByText("Alan Turing")).toBeTruthy();
    expect(screen.getByText("Katherine Johnson")).toBeTruthy();
    expect(getAdminUsers).toHaveBeenCalledWith("admin-token", "");
  });

  it("renders error state and retries loading when Retry is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getAdminUsers)
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce({
        items: sampleUsers,
        total: 2,
        limit: 20,
        offset: 0,
      });

    render(<AdminUsersPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Network failure");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Alan Turing")).toBeTruthy();
    expect(getAdminUsers).toHaveBeenCalledTimes(2);
  });

  it("delegates 401 and 403 ApiErrors to handleError", async () => {
    const forbiddenError = new ApiError(403, "Forbidden", null);
    vi.mocked(getAdminUsers).mockRejectedValueOnce(forbiddenError);

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(forbiddenError);
    });
  });

  it("searches accounts by query and displays empty state when none match", async () => {
    const user = userEvent.setup();
    vi.mocked(getAdminUsers)
      .mockResolvedValueOnce({
        items: sampleUsers,
        total: 2,
        limit: 20,
        offset: 0,
      })
      .mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

    render(<AdminUsersPage />);

    await screen.findByText("Alan Turing");

    const searchInput = screen.getByLabelText(
      "Search accounts by email or name",
    );
    await user.type(searchInput, "nonexistent");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("No accounts match “nonexistent”."),
    ).toBeTruthy();
  });

  it("opens confirmation dialog, promotes user to Contributor, and reloads list", async () => {
    const user = userEvent.setup();
    vi.mocked(getAdminUsers)
      .mockResolvedValueOnce({
        items: sampleUsers,
        total: 2,
        limit: 20,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [
          { ...sampleUsers[0], role: "contributor" },
          sampleUsers[1],
        ],
        total: 2,
        limit: 20,
        offset: 0,
      });

    vi.mocked(changeAdminUserRole).mockResolvedValueOnce({
      action: "promoted",
      role_before: "learner",
      role_after: "contributor",
      changed_at: "2026-01-03T00:00:00Z",
      user: { ...sampleUsers[0], role: "contributor" },
    });

    render(<AdminUsersPage />);

    await screen.findByText("Alan Turing");

    await user.click(screen.getByRole("button", { name: "Make Contributor" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Confirm: make Contributor" }),
    );

    expect(changeAdminUserRole).toHaveBeenCalledWith(
      "admin-token",
      "u-1",
      "contributor",
    );
    expect(
      await screen.findByText("Alan Turing is now a Contributor."),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("displays an error inside the dialog when role change fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getAdminUsers).mockResolvedValueOnce({
      items: sampleUsers,
      total: 2,
      limit: 20,
      offset: 0,
    });

    vi.mocked(changeAdminUserRole).mockRejectedValueOnce(
      new ApiError(400, "Cannot modify user role", null),
    );

    render(<AdminUsersPage />);

    await screen.findByText("Alan Turing");

    await user.click(screen.getByRole("button", { name: "Make Contributor" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm: make Contributor" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Cannot modify user role");
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});