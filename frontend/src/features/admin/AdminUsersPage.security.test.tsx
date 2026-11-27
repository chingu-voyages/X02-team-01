import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";
import { changeAdminUserRole, getAdminUsers, updateGradingPermissions, type AdminUserItem } from "@/lib/admin-users-api";
import { getAdministratorPromotionEligibility, promoteAdministrator, type AdministratorPromotionEligibility } from "@/lib/admin-promotion-api";
import AdminUsersPage from "./AdminUsersPage";

const { logout, handleError } = vi.hoisted(() => ({ logout: vi.fn(), handleError: vi.fn() }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ ready: true, token: "admin-token", handleError }),
  useAuth: () => ({ logout }),
}));
vi.mock("@/lib/admin-users-api", () => ({ changeAdminUserRole: vi.fn(), getAdminUsers: vi.fn(), updateGradingPermissions: vi.fn() }));
vi.mock("@/lib/admin-promotion-api", () => ({ getAdministratorPromotionEligibility: vi.fn(), promoteAdministrator: vi.fn() }));

const contributor: AdminUserItem = { id: "contributor-id", email: "contributor@example.test", fullName: "Test Contributor", role: "contributor", is_verified: true, grade_short_answers: false, grade_essays: true, created_at: "2026-11-01T00:00:00Z" };
const learner: AdminUserItem = { ...contributor, id: "learner-id", email: "learner@example.test", fullName: "Test Learner", role: "learner" };
const administrator: AdminUserItem = { ...contributor, id: "admin-id", email: "admin@example.test", fullName: "Test Administrator", role: "administrator" };
const eligible: AdministratorPromotionEligibility = { target: contributor, mfa_enrolled: true, eligible: true, issues: [], recent_authentication: true, authentication_max_age_seconds: 300 };
const get = vi.mocked(getAdminUsers);
const preview = vi.mocked(getAdministratorPromotionEligibility);
const promote = vi.mocked(promoteAdministrator);
const grading = vi.mocked(updateGradingPermissions);

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ items: [learner, contributor, administrator], total: 3, limit: 50, offset: 0 });
  preview.mockResolvedValue(eligible);
});
afterEach(cleanup);

async function openPromotion(user: ReturnType<typeof userEvent.setup>) {
  render(<AdminUsersPage />);
  await user.click(await screen.findByRole("button", { name: "Grant Administrator access" }));
  return screen.findByRole("dialog", { name: "Grant Administrator access" });
}

async function fillConfirmation(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(await within(dialog).findByLabelText("Reason for granting access"), "Approved team administrator");
  await user.type(within(dialog).getByLabelText("Confirm the account email"), contributor.email);
  await user.click(within(dialog).getByRole("checkbox", { name: /I understand that this grants/ }));
}

describe("Users & Access — JHEP-207", () => {
  it("only offers the promotion workflow to contributors and loads eligibility on demand", async () => {
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await screen.findByText(contributor.email);
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Grant Administrator access" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Grant Administrator access" }));
    expect(await screen.findByText("All account eligibility checks passed.")).toBeTruthy();
    expect(preview).toHaveBeenCalledWith("admin-token", contributor.id);
  });
  it("blocks ineligible targets and refreshes eligibility without a mutation", async () => {
    preview.mockResolvedValueOnce({ ...eligible, mfa_enrolled: false, eligible: false, issues: [{ code: "ADMIN_PROMOTION_MFA_REQUIRED", message: "Complete MFA enrollment first." }] });
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    expect(await within(dialog).findByText("Complete MFA enrollment first.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Confirm Administrator promotion" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Refresh eligibility" }));
    expect(await within(dialog).findByRole("button", { name: "Confirm Administrator promotion" })).toBeDisabled();
    expect(promote).not.toHaveBeenCalled();
  });
  it("requests a new sign-in when authentication is too old", async () => {
    preview.mockResolvedValue({ ...eligible, recent_authentication: false });
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    expect(await within(dialog).findByText("Fresh sign-in required")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Sign in again" }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(promote).not.toHaveBeenCalled();
  });
  it("requires reason, exact email and acknowledgement; only then promotes and reloads", async () => {
    const promoted = { ...contributor, role: "administrator" as const };
    promote.mockResolvedValue({ user: promoted, audit_id: "audit-id", action: "promoted", role_before: "contributor", role_after: "administrator", changed_at: contributor.created_at, previous_privileged_sessions_revoked: true });
    get.mockResolvedValueOnce({ items: [contributor], total: 1, limit: 50, offset: 0 }).mockResolvedValue({ items: [promoted], total: 1, limit: 50, offset: 0 });
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    const submit = await within(dialog).findByRole("button", { name: "Confirm Administrator promotion" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason for granting access"), "Team approval");
    await user.type(within(dialog).getByLabelText("Confirm the account email"), "wrong@example.test");
    await user.click(within(dialog).getByRole("checkbox", { name: /I understand that this grants/ }));
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Confirm the account email"));
    await user.type(within(dialog).getByLabelText("Confirm the account email"), contributor.email);
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(promote).toHaveBeenCalledExactlyOnceWith("admin-token", contributor.id, { confirmation_email: contributor.email, reason: "Team approval", confirm: true });
    expect(await screen.findByText(/Test Contributor is now an Administrator/)).toBeTruthy();
    expect(await screen.findByText("administrator")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Grant Administrator access" })).toBeNull();
    expect(changeAdminUserRole).not.toHaveBeenCalled();
  });
  it("handles fresh authentication expiring after preview", async () => {
    promote.mockRejectedValue(new ApiError(403, "Forbidden", { code: "ADMIN_PROMOTION_REAUTH_REQUIRED", message: "Sign in again before promoting." }));
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    await fillConfirmation(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Confirm Administrator promotion" }));
    expect(await within(dialog).findByText("Fresh sign-in required")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Confirm Administrator promotion" })).toBeNull();
    expect(handleError).not.toHaveBeenCalled();
  });
  it("does not retry uncertain promotion until a fresh preview and confirmation", async () => {
    promote.mockRejectedValue(new Error("connection lost"));
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    await fillConfirmation(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Confirm Administrator promotion" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/could not confirm/);
    expect(within(dialog).getByRole("button", { name: "Confirm Administrator promotion" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Refresh eligibility" }));
    expect(await within(dialog).findByRole("button", { name: "Confirm Administrator promotion" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Confirm the account email")).toHaveValue("");
    expect(promote).toHaveBeenCalledTimes(1);
  });
  it("can cancel with Escape without changing privileges", async () => {
    const user = userEvent.setup();
    const dialog = await openPromotion(user);
    await within(dialog).findByText("All account eligibility checks passed.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Grant Administrator access" })).toHaveFocus();
    expect(promote).not.toHaveBeenCalled();
  });
  it("saves the edited grading selections instead of the original values", async () => {
    const saved = { ...contributor, grade_short_answers: true, grade_essays: false };
    grading.mockResolvedValue({ user: saved, changes: [] });
    get.mockResolvedValueOnce({ items: [contributor], total: 1, limit: 50, offset: 0 }).mockResolvedValue({ items: [saved], total: 1, limit: 50, offset: 0 });
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await user.click(await screen.findByRole("button", { name: "Grading Permissions" }));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save permissions" });
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Grade short answers/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Grade essays/ }));
    await user.click(save);
    expect(grading).toHaveBeenCalledExactlyOnceWith("admin-token", contributor.id, { grade_short_answers: true, grade_essays: false });
    expect(await screen.findByText(/grading permissions were saved/)).toBeTruthy();
    expect(await screen.findByText("Grades: short answers")).toBeTruthy();
  });
  it("sends pagination to the server rather than truncating the account list", async () => {
    get.mockResolvedValueOnce({ items: [contributor], total: 51, offset: 0, limit: 50 }).mockResolvedValue({ items: [learner], total: 51, offset: 50, limit: 50 });
    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("admin-token", "", { limit: 50, offset: 50 }));
    expect(await screen.findByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
  it("handles 401 via the session hook and displays 403 as an access error", async () => {
    const unauthorized = new ApiError(401, "Session expired");
    get.mockRejectedValueOnce(unauthorized);
    render(<AdminUsersPage />);
    await waitFor(() => expect(handleError).toHaveBeenCalledWith(unauthorized));
    cleanup();
    handleError.mockClear();
    get.mockRejectedValueOnce(new ApiError(403, "Access denied"));
    render(<AdminUsersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
    expect(handleError).not.toHaveBeenCalled();
  });
});
