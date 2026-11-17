import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT,
} from "./route";


const originalEnv =
  process.env.BACKEND_PROXY_TARGET;


afterEach(() => {
  if (
    originalEnv === undefined
  ) {
    delete process.env
      .BACKEND_PROXY_TARGET;
  } else {
    process.env.BACKEND_PROXY_TARGET =
      originalEnv;
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});


function makeContext(
  segments: string[],
) {
  return {
    params: Promise.resolve({
      path: segments,
    }),
  };
}


describe(
  "same-origin API proxy",
  () => {
    it(
      "forwards to BACKEND_PROXY_TARGET at request time",
      async () => {
        process.env.BACKEND_PROXY_TARGET =
          "https://backend.example.com";

        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            '{"ok":true}',
            {
              status: 200,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const response =
          await GET(
            new Request(
              "http://frontend.test/api/v1/auth/login?next=/exams",
            ),
            makeContext([
              "auth",
              "login",
            ]),
          );

        expect(
          response.status,
        ).toBe(200);

        const call =
          fetchMock.mock.calls[0];

        if (!call) {
          throw new Error(
            "Expected upstream fetch to be called",
          );
        }

        const [
          calledUrl,
          calledInit,
        ] = call;

        expect(
          calledUrl,
        ).toBe(
          "https://backend.example.com/api/v1/auth/login?next=/exams",
        );

        expect(
          calledInit?.method,
        ).toBe("GET");
      },
    );


    it(
      "falls back to port 8010 when BACKEND_PROXY_TARGET is unset",
      async () => {
        delete process.env
          .BACKEND_PROXY_TARGET;

        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            null,
            {
              status: 204,
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        await GET(
          new Request(
            "http://frontend.test/api/v1/exams",
          ),
          makeContext([
            "exams",
          ]),
        );

        const call =
          fetchMock.mock.calls[0];

        if (!call) {
          throw new Error(
            "Expected upstream fetch to be called",
          );
        }

        expect(
          call[0],
        ).toBe(
          "http://127.0.0.1:8010/api/v1/exams",
        );
      },
    );


    it(
      "normalizes whitespace, trailing slash, and accidental api prefix",
      async () => {
        process.env.BACKEND_PROXY_TARGET =
          "  http://127.0.0.1:8010/api/v1/  ";

        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            null,
            {
              status: 204,
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        await GET(
          new Request(
            "http://frontend.test/api/v1/categories",
          ),
          makeContext([
            "categories",
          ]),
        );

        const call =
          fetchMock.mock.calls[0];

        if (!call) {
          throw new Error(
            "Expected upstream fetch to be called",
          );
        }

        expect(
          call[0],
        ).toBe(
          "http://127.0.0.1:8010/api/v1/categories",
        );
      },
    );


    it(
      "forwards POST bodies and drops hop-by-hop headers",
      async () => {
        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            '{"token":"abc"}',
            {
              status: 200,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const request =
          new Request(
            "http://frontend.test/api/v1/auth/login",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
                host:
                  "frontend.test",
                connection:
                  "keep-alive",
              },
              body: JSON.stringify({
                email:
                  "a@b.test",
                password:
                  "x",
              }),
            },
          );

        const response =
          await POST(
            request,
            makeContext([
              "auth",
              "login",
            ]),
          );

        expect(
          response.status,
        ).toBe(200);

        const call =
          fetchMock.mock.calls[0];

        if (!call) {
          throw new Error(
            "Expected upstream fetch to be called",
          );
        }

        const [
          calledUrl,
          calledInit,
        ] = call;

        expect(
          calledUrl,
        ).toBe(
          "http://127.0.0.1:8010/api/v1/auth/login",
        );

        expect(
          calledInit?.method,
        ).toBe(
          "POST",
        );

        const headers =
          new Headers(
            calledInit?.headers,
          );

        expect(
          headers.get(
            "content-type",
          ),
        ).toBe(
          "application/json",
        );

        expect(
          headers.get(
            "host",
          ),
        ).toBeNull();

        expect(
          headers.get(
            "connection",
          ),
        ).toBeNull();

        expect(
          calledInit?.body,
        ).toBeInstanceOf(
          ArrayBuffer,
        );
      },
    );


    it(
      "preserves multipart request content type",
      async () => {
        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            '{"ok":true}',
            {
              status: 200,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const formData =
          new FormData();

        formData.append(
          "alt_text",
          "Question diagram",
        );

        formData.append(
          "file",
          new Blob(
            [
              "fake-image",
            ],
            {
              type:
                "image/png",
            },
          ),
          "diagram.png",
        );

        await POST(
          new Request(
            "http://frontend.test/api/v1/admin/questions/question-1/images",
            {
              method:
                "POST",
              body:
                formData,
            },
          ),
          makeContext([
            "admin",
            "questions",
            "question-1",
            "images",
          ]),
        );

        const call =
          fetchMock.mock.calls[0];

        if (!call) {
          throw new Error(
            "Expected upstream fetch to be called",
          );
        }

        const headers =
          new Headers(
            call[1]?.headers,
          );

        expect(
          headers.get(
            "content-type",
          ),
        ).toContain(
          "multipart/form-data",
        );
      },
    );


    it(
      "returns upstream status and headers",
      async () => {
        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockResolvedValue(
          new Response(
            JSON.stringify({
              code:
                "INVALID_CREDENTIALS",
              message:
                "Invalid credentials",
            }),
            {
              status: 401,
              headers: {
                "content-type":
                  "application/json",
              },
            },
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const response =
          await DELETE(
            new Request(
              "http://frontend.test/api/v1/auth/logout",
              {
                method:
                  "DELETE",
              },
            ),
            makeContext([
              "auth",
              "logout",
            ]),
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          response.headers.get(
            "content-type",
          ),
        ).toContain(
          "application/json",
        );

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          code:
            "INVALID_CREDENTIALS",
        });
      },
    );


    it(
      "returns a useful 502 when FastAPI cannot be reached",
      async () => {
        const fetchMock =
          vi.fn<typeof fetch>();

        fetchMock.mockRejectedValue(
          new TypeError(
            "fetch failed",
          ),
        );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const consoleError =
          vi.spyOn(
            console,
            "error",
          )
            .mockImplementation(
              () => undefined,
            );

        const response =
          await GET(
            new Request(
              "http://frontend.test/api/v1/categories",
            ),
            makeContext([
              "categories",
            ]),
          );

        expect(
          response.status,
        ).toBe(502);

        await expect(
          response.json(),
        ).resolves.toEqual({
          detail:
            "Backend API is unavailable. Check BACKEND_PROXY_TARGET and make sure FastAPI is running.",
        });

        expect(
          consoleError,
        ).toHaveBeenCalled();
      },
    );


    it(
      "exports every HTTP method required by the frontend",
      () => {
        expect(
          typeof GET,
        ).toBe(
          "function",
        );

        expect(
          typeof POST,
        ).toBe(
          "function",
        );

        expect(
          typeof PUT,
        ).toBe(
          "function",
        );

        expect(
          typeof PATCH,
        ).toBe(
          "function",
        );

        expect(
          typeof DELETE,
        ).toBe(
          "function",
        );
      },
    );
  },
);