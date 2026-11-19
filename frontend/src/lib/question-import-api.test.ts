import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  commitQuestionImport,
  getQuestionImportRows,
  uploadQuestionImport,
  uploadQuestionImportAsset,
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
  "question import API",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });


    it(
      "uploads the workbook as FormData",
      async () => {
        const response = {
          id: "batch-1",
          status: "ready",
        };

        const mockFetch =
          mockResponse(
            201,
            response,
          );

        const file =
          new File(
            ["xlsx"],
            "questions.xlsx",
            {
              type:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          );

        await uploadQuestionImport(
          "token",
          file,
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
          "/api/v1/admin/question-imports",
        );

        expect(
          options?.method,
        ).toBe(
          "POST",
        );

        expect(
          options?.body,
        ).toBeInstanceOf(
          FormData,
        );

        expect(
          new Headers(
            options?.headers,
          ).get(
            "Content-Type",
          ),
        ).toBeNull();
      },
    );


    it(
      "uploads an image asset to the batch",
      async () => {
        const mockFetch =
          mockResponse(
            201,
            {
              asset: {},
              batch: {},
            },
          );

        const file =
          new File(
            ["png"],
            "vpc.png",
            {
              type:
                "image/png",
            },
          );

        await uploadQuestionImportAsset(
          "token",
          "batch-1",
          file,
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
          "/api/v1/admin/question-imports/batch-1/assets",
        );

        expect(
          options?.method,
        ).toBe(
          "POST",
        );

        expect(
          options?.body,
        ).toBeInstanceOf(
          FormData,
        );
      },
    );


    it(
      "encodes preview filters and pagination",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              items: [],
              total: 0,
              page: 2,
              page_size: 50,
            },
          );

        await getQuestionImportRows(
          "token",
          "batch-1",
          {
            row_status:
              "invalid",
            page:
              2,
            page_size:
              50,
          },
        );

        const [
          rawUrl,
        ] =
          mockFetch.mock
            .calls[0]!;

        const url =
          new URL(
            String(
              rawUrl,
            ),
            "http://localhost",
          );

        expect(
          url.pathname,
        ).toBe(
          "/api/v1/admin/question-imports/batch-1/rows",
        );

        expect(
          url.searchParams.get(
            "row_status",
          ),
        ).toBe(
          "invalid",
        );

        expect(
          url.searchParams.get(
            "page",
          ),
        ).toBe(
          "2",
        );
      },
    );


    it(
      "confirms a validated batch",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              batch: {},
              created_count: 10,
              created_question_ids: [],
              already_imported: false,
            },
          );

        await commitQuestionImport(
          "token",
          "batch-1",
        );

        expect(
          mockFetch.mock
            .calls[0]?.[0],
        ).toBe(
          "/api/v1/admin/question-imports/batch-1/commit",
        );

        expect(
          mockFetch.mock
            .calls[0]?.[1]?.method,
        ).toBe(
          "POST",
        );
      },
    );
  },
);
