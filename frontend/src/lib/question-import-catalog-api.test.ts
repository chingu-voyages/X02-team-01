import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmImportCatalog, getImportCatalogPlan } from "./question-import-catalog-api";

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("question import catalog API", () => {
  it("requests the read-only catalog plan with bearer authorization", async () => {
    const plan = { batch_id: "batch/1", plan_id: "a".repeat(64), missing_certifications: [], missing_categories: [], blocking_issues: [], can_confirm: false };
    const fetchMock = stub(200, plan);
    expect(await getImportCatalogPlan("token", "batch/1")).toEqual(plan);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/admin/question-imports/batch%2F1/catalog-plan");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("posts only the confirmed plan and certification configuration", async () => {
    const payload = { plan_id: "a".repeat(64), confirm: true as const, certifications: [{ code: "CS-100", name: "Computer Science", passing_threshold_pct: 70, feedback_mode: "deferred" as const }] };
    const receipt = { batch: { id: "batch-1", status: "ready" }, created_certification_ids: ["cert-1"], created_category_ids: ["category-1"] };
    const fetchMock = stub(200, receipt);
    expect(await confirmImportCatalog("token", "batch-1", payload)).toEqual(receipt);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/admin/question-imports/batch-1/catalog-confirm");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(payload);
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("preserves stale-plan conflicts for the UI", async () => {
    const detail = { code: "IMPORT_CATALOG_PLAN_CHANGED", message: "The catalog has changed." };
    stub(409, { detail });
    await expect(confirmImportCatalog("token", "batch-1", { plan_id: "a".repeat(64), confirm: true, certifications: [] })).rejects.toMatchObject({ status: 409, detail });
  });
});
