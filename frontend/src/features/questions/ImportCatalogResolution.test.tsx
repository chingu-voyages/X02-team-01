import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportCatalogResolution from "./ImportCatalogResolution";
import { ApiError } from "@/lib/api-client";
import { getImportCatalogPlan, type ImportCatalogPlan, type ImportCatalogConfirmation } from "@/lib/question-import-catalog-api";

vi.mock("@/lib/question-import-catalog-api", () => ({ getImportCatalogPlan: vi.fn() }));

const batchId = "11111111-1111-4111-8111-111111111111";
const plan: ImportCatalogPlan = {
  batch_id: batchId,
  plan_id: "a".repeat(64),
  missing_certifications: [{ code: "CS-100", row_numbers: [2, 4] }],
  missing_categories: [{ certification_code: "CS-100", name: "Algorithms", row_numbers: [2, 4] }],
  blocking_issues: [],
  can_confirm: true,
};
const mockPlan = vi.mocked(getImportCatalogPlan);
const onConfirm = vi.fn<(payload: ImportCatalogConfirmation) => Promise<void>>();
const onUnauthorized = vi.fn();

function show(role = "administrator", busy = false) {
  return render(<ImportCatalogResolution batchId={batchId} token="token" role={role} busy={busy} onConfirm={onConfirm} onUnauthorized={onUnauthorized} />);
}

async function open(role = "administrator") {
  const user = userEvent.setup();
  show(role);
  await user.click(screen.getByRole("button", { name: "Review missing records" }));
  await screen.findByText("Algorithms");
  return user;
}

function createButton() {
  return screen.getByRole("button", { name: "Create records & revalidate" }) as HTMLButtonElement;
}

function confirmation() {
  return screen.getByRole("checkbox", { name: "I confirm creation of the listed catalog records." });
}

async function configure(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Certification name (CS-100)"), "Computer Science");
  await user.type(screen.getByLabelText("Passing threshold (%) (CS-100)"), "70");
  await user.selectOptions(screen.getByLabelText("Feedback mode (CS-100)"), "immediate");
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPlan.mockResolvedValue(plan);
  onConfirm.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("JHEP-207 missing catalog confirmation", () => {
  it("does not fetch a preview or create anything until requested", () => {
    show();
    expect(mockPlan).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the exact additions and requires configuration and explicit confirmation", async () => {
    const user = await open();
    expect(mockPlan).toHaveBeenCalledWith("token", batchId);
    expect(screen.getByText("1 new certification · 1 new category")).toBeTruthy();
    expect(screen.getAllByText("2 affected rows")).toHaveLength(2);
    expect(createButton().disabled).toBe(true);
    await configure(user);
    expect(createButton().disabled).toBe(true);
    await user.click(confirmation());
    await user.click(createButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      plan_id: plan.plan_id,
      confirm: true,
      certifications: [{ code: "CS-100", name: "Computer Science", passing_threshold_pct: 70, feedback_mode: "immediate" }],
    });
  });

  it("validates blank names and invalid whole-number thresholds before sending a request", async () => {
    const user = await open();
    const name = screen.getByLabelText("Certification name (CS-100)");
    const threshold = screen.getByLabelText("Passing threshold (%) (CS-100)");
    await user.type(threshold, "101");
    await user.click(confirmation());
    await user.click(createButton());
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(threshold.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a whole-number passing threshold from 0 to 100.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows category-only resolution without inventing certification settings", async () => {
    mockPlan.mockResolvedValue({ ...plan, missing_certifications: [] });
    const user = await open();
    expect(screen.queryByRole("textbox", { name: /Certification name/ })).toBeNull();
    await user.click(confirmation());
    await user.click(createButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ plan_id: plan.plan_id, confirm: true, certifications: [] });
  });

  it("cancels the preview without changing the catalog and restores focus", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Cancel creation" }));
    expect(screen.queryByText("Algorithms")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review missing records" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("offers a read-only preview to contributors even if a response claims confirmation is available", async () => {
    await open("contributor");
    expect(screen.getByText(/Ask an administrator to create/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create records & revalidate" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows blocking catalog references and prevents creation", async () => {
    mockPlan.mockResolvedValue({ ...plan, can_confirm: false, blocking_issues: [{ row_number: 3, field: "category_name", message: "Category name is ambiguous." }] });
    await open();
    expect(screen.getByText(/Row 3 \(category name\): Category name is ambiguous/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requires a new preview and acknowledgement when a confirmation becomes stale", async () => {
    onConfirm.mockRejectedValueOnce(new ApiError(409, "Conflict", { code: "IMPORT_CATALOG_PLAN_CHANGED", message: "The catalog has changed." }));
    const user = await open();
    await configure(user);
    await user.click(confirmation());
    await user.click(createButton());
    expect((await screen.findByRole("alert")).textContent).toContain("Refresh the catalog preview");
    expect(createButton().disabled).toBe(true);
    expect((screen.getByLabelText("Certification name (CS-100)") as HTMLInputElement).value).toBe("Computer Science");
    const updatedPlan = { ...plan, plan_id: "b".repeat(64) };
    mockPlan.mockResolvedValueOnce(updatedPlan);
    await user.click(screen.getByRole("button", { name: "Refresh catalog preview" }));
    await waitFor(() => expect((confirmation() as HTMLInputElement).disabled).toBe(false));
    expect((confirmation() as HTMLInputElement).checked).toBe(false);
    await user.click(confirmation());
    await user.click(createButton());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm.mock.calls[1][0].plan_id).toBe(updatedPlan.plan_id);
  });

  it("preserves entered fields after a network failure and does not blindly repeat the write", async () => {
    onConfirm.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = await open();
    await configure(user);
    await user.click(confirmation());
    await user.click(createButton());
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection");
    expect((screen.getByLabelText("Passing threshold (%) (CS-100)") as HTMLInputElement).value).toBe("70");
    expect(createButton().disabled).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("delegates expired-session errors to the existing auth handler", async () => {
    const error = new ApiError(401, "Session expired");
    mockPlan.mockRejectedValueOnce(error);
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Review missing records" }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith(error));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
