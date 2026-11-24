import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  publishQuestionImport,
} from "./question-import-api";


function mockResponse(
  status: number,
  body: unknown,
) {
  const mockFetch =
    vi.fn<
      typeof fetch
    >()
      .mockResolvedValue({
        ok:
          status >= 200 &&
          status < 300,
        status,
        json:
          async () =>
            body,
      } as Response);

  vi.stubGlobal(
    "fetch",
    mockFetch,
  );

  return mockFetch;
}


describe(
  "question import publication API",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });


    it(
      "posts the Administrator bulk-publication action",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              batch: {
                id:
                  "batch-1",
                status:
                  "imported",
              },
              requested_count:
                60,
              published_count:
                60,
              already_published_count:
                0,
              published_question_ids:
                [],
              already_published_question_ids:
                [],
              all_published:
                true,
            },
          );

        await publishQuestionImport(
          "admin-token",
          "batch/with spaces",
        );

        const [
          url,
          options,
        ] =
          mockFetch.mock
            .calls[0]!;

        expect(
          url,
        ).toBe(
          "/api/v1/admin/question-imports/batch%2Fwith%20spaces/publish",
        );

        expect(
          options?.method,
        ).toBe(
          "POST",
        );

        expect(
          new Headers(
            options?.headers,
          ).get(
            "Authorization",
          ),
        ).toBe(
          "Bearer admin-token",
        );
      },
    );
  },
);
