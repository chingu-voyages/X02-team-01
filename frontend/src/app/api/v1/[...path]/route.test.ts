import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST, PUT } from "./route";

const originalEnv = process.env.BACKEND_PROXY_TARGET;

afterEach(() => {
  // assigning undefined would store the literal string "undefined"
  if (originalEnv === undefined) {
    delete process.env.BACKEND_PROXY_TARGET;
  } else {
    process.env.BACKEND_PROXY_TARGET = originalEnv;
  }
  vi.restoreAllMocks();
});

function makeContext(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) };
}

describe("same-origin API proxy (JHEP-99)", () => {
  it("forwards to BACKEND_PROXY_TARGET at request time", async () => {
    process.env.BACKEND_PROXY_TARGET = "https://backend.example.com";
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://frontend.test/api/v1/auth/login?next=/exams"),
      makeContext(["auth", "login"]),
    );

    expect(response.status).toBe(200);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("https://backend.example.com/api/v1/auth/login?next=/exams");
    expect(calledInit!.method).toBe("GET");
  });

  it("falls back to the local backend when the env is unset", async () => {
    delete process.env.BACKEND_PROXY_TARGET;
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await GET(
      new Request("http://frontend.test/api/v1/exams"),
      makeContext(["exams"]),
    );

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8010/api/v1/exams");
  });

  it("forwards POST bodies and drops hop-by-hop headers", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{"token":"abc"}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://frontend.test/api/v1/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "frontend.test",
        connection: "keep-alive",
      },
      body: JSON.stringify({ email: "a@b.test", password: "x" }),
    });
    const response = await POST(request, makeContext(["auth", "login"]));

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("http://127.0.0.1:8010/api/v1/auth/login");
    expect((calledInit!.headers as Headers).get("content-type")).toBe(
      "application/json",
    );
    expect((calledInit!.headers as Headers).get("host")).toBeNull();
    expect((calledInit!.headers as Headers).get("connection")).toBeNull();
    expect((calledInit!.body as ArrayBuffer).byteLength).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ token: "abc" });
  });

  it("returns the upstream status and headers (e.g. 401 coded auth errors)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response('{"code":"INVALID_CREDENTIALS","message":"x"}', {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await DELETE(
      new Request("http://frontend.test/api/v1/auth/logout", {
        method: "DELETE",
      }),
      makeContext(["auth", "logout"]),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("exports every browser-relevant method through the same proxy", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
    expect(typeof PUT).toBe("function");
    expect(typeof DELETE).toBe("function");
  });
});
