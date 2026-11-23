import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdminUserRow from "./AdminUserRow";
import type { AdminUserItem } from "@/lib/admin-users-api";

const baseUser: AdminUserItem = {
  id: "user-1",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  role: "learner",
  is_verified: true,
  created_at: "2026-01-01T00:00:00Z",
};

describe("AdminUserRow", () => {
  const onRequestRoleChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders learner details, verified status, and Make Contributor action", async () => {
    const user = userEvent.setup();

    render(
      <ul>
        <AdminUserRow
          user={baseUser}
          onRequestRoleChange={onRequestRoleChange}
        />
      </ul>,
    );

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("learner")).toBeTruthy();
    expect(screen.getByText("verified")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Make Contributor" });
    await user.click(button);

    expect(onRequestRoleChange).toHaveBeenCalledTimes(1);
    expect(onRequestRoleChange).toHaveBeenCalledWith(baseUser, "contributor");
  });

  it("renders unverified status and Revoke Contributor action for contributors", async () => {
    const user = userEvent.setup();
    const contributorUser: AdminUserItem = {
      ...baseUser,
      role: "contributor",
      is_verified: false,
    };

    render(
      <ul>
        <AdminUserRow
          user={contributorUser}
          onRequestRoleChange={onRequestRoleChange}
        />
      </ul>,
    );

    expect(screen.getByText("contributor")).toBeTruthy();
    expect(screen.getByText("unverified")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Revoke Contributor" });
    await user.click(button);

    expect(onRequestRoleChange).toHaveBeenCalledTimes(1);
    expect(onRequestRoleChange).toHaveBeenCalledWith(
      contributorUser,
      "learner",
    );
  });

  it("renders a non-interactive Administrator label without role toggle buttons", () => {
    const adminUser: AdminUserItem = {
      ...baseUser,
      role: "administrator",
    };

    render(
      <ul>
        <AdminUserRow
          user={adminUser}
          onRequestRoleChange={onRequestRoleChange}
        />
      </ul>,
    );

    expect(screen.getByText("administrator")).toBeTruthy();
    expect(screen.getByText("Administrator")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});