import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RoleChangeDialog from "./RoleChangeDialog";
import type { AdminUserItem } from "@/lib/admin-users-api";

const mockUser: AdminUserItem = {
  id: "user-1",
  fullName: "Grace Hopper",
  email: "grace@example.com",
  role: "learner",
  is_verified: true,
  created_at: "2026-01-01T00:00:00Z",
};

describe("RoleChangeDialog", () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders grant Contributor copy and triggers confirm/cancel callbacks", async () => {
    const user = userEvent.setup();

    render(
      <RoleChangeDialog
        user={mockUser}
        targetRole="contributor"
        isSubmitting={false}
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Grant Contributor access?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Grace Hopper (grace@example.com) will gain draft-authoring access.",
      ),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Confirm: make Contributor" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders revoke Contributor copy when targetRole is learner", () => {
    render(
      <RoleChangeDialog
        user={{ ...mockUser, role: "contributor" }}
        targetRole="learner"
        isSubmitting={false}
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Revoke Contributor access?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/will lose Contributor access immediately/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirm: revoke Contributor" }),
    ).toBeTruthy();
  });

  it("displays an error alert when error is provided", () => {
    render(
      <RoleChangeDialog
        user={mockUser}
        targetRole="contributor"
        isSubmitting={false}
        error="Unable to change the role"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Unable to change the role");
  });

  it("disables buttons and shows Applying... while isSubmitting is true", () => {
    render(
      <RoleChangeDialog
        user={mockUser}
        targetRole="contributor"
        isSubmitting={true}
        error={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const cancelButton = screen.getByRole("button", {
      name: "Cancel",
    }) as HTMLButtonElement;
    const confirmButton = screen.getByRole("button", {
      name: "Applying...",
    }) as HTMLButtonElement;

    expect(cancelButton.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(true);
  });
});