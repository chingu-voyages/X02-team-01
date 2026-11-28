import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdministratorPromotionEligibility, promoteAdministrator } from "./admin-promotion-api";
import { getAdminUsers } from "./admin-users-api";

afterEach(() => vi.unstubAllGlobals());

describe("Administrator promotion API", () => {
  it("uses the separate read-only eligibility endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ eligible: true }) });
    vi.stubGlobal("fetch", fetcher);
    await getAdministratorPromotionEligibility("token", "a/b");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/users/a%2Fb/administrator-promotion", expect.objectContaining({ method: "GET", cache: "no-store" }));
  });
  it("sends only the explicit confirmation payload to the promotion route", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ audit_id: "audit" }) });
    vi.stubGlobal("fetch", fetcher);
    const payload = { confirmation_email: "test@example.test", confirm: true as const, reason: "Team approval" };
    await promoteAdministrator("token", "user-id", payload);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/users/user-id/administrator-promotion", expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }));
  });
  it("encodes search and server pagination", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetcher);
    await getAdminUsers("token", "a+b@example.test", { limit: 50, offset: 50 });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/users?q=a%2Bb%40example.test&limit=50&offset=50", expect.objectContaining({ method: "GET" }));
  });
});
