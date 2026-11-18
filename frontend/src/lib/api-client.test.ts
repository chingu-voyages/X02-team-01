import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  apiRequest,
} from "./api-client";


afterEach(() => {
  vi.unstubAllGlobals();
});


describe(
  "API client",
  () => {
    it(
      "always uses the same-origin API proxy",
      async () => {
        const mockFetch =
          vi.fn()
            .mockResolvedValue({
              ok: true,
              status: 200,

              json: async () => ({
                ok: true,
              }),
            });

        vi.stubGlobal(
          "fetch",
          mockFetch,
        );

        await apiRequest(
          "/admin/questions",
          "test-token",
        );

        expect(
          mockFetch,
        ).toHaveBeenCalledWith(
          "/api/v1/admin/questions",
          expect.any(
            Object,
          ),
        );
      },
    );


    it(
      "preserves an existing attempt ID from a 409",
      async () => {
        const attemptId =
          "11111111-1111-4111-8111-111111111111";

        vi.stubGlobal(
          "fetch",
          vi.fn()
            .mockResolvedValue({
              ok: false,
              status: 409,

              json: async () => ({
                detail: {
                  code:
                    "ATTEMPT_IN_PROGRESS",

                  attempt_id:
                    attemptId,
                },
              }),
            }),
        );

        await expect(
          apiRequest(
            "/exams",
            "test-token",
            {
              method:
                "POST",
            },
          ),
        ).rejects.toMatchObject({
          name:
            "ApiError",

          status:
            409,

          detail: {
            code:
              "ATTEMPT_IN_PROGRESS",

            attempt_id:
              attemptId,
          },
        });
      },
    );


    it(
      "handles a conflict with invalid JSON",
      async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn()
            .mockResolvedValue({
              ok: false,
              status: 409,

              json:
                async () => {
                  throw new SyntaxError(
                    "Invalid JSON",
                  );
                },
            }),
        );

        await expect(
          apiRequest(
            "/exams",
            "test-token",
          ),
        ).rejects.toMatchObject({
          name:
            "ApiError",

          status:
            409,

          detail:
            null,
        });
      },
    );


    it(
      "does not overwrite the multipart FormData content type",
      async () => {
        const mockFetch =
          vi.fn()
            .mockResolvedValue({
              ok: true,
              status: 200,

              json: async () => ({
                ok: true,
              }),
            });

        vi.stubGlobal(
          "fetch",
          mockFetch,
        );

        const formData =
          new FormData();

        formData.append(
          "alt_text",
          "Diagram",
        );

        await apiRequest(
          "/admin/questions/test/images",
          "test-token",
          {
            method:
              "POST",

            body:
              formData,
          },
        );

        const options =
          mockFetch.mock
            .calls[0]?.[1];

        const headers =
          new Headers(
            options?.headers,
          );

        expect(
          headers.get(
            "Content-Type",
          ),
        ).toBeNull();

        expect(
          headers.get(
            "Authorization",
          ),
        ).toBe(
          "Bearer test-token",
        );
      },
    );
  },
);