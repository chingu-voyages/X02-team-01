import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getManagedQuestions,
} from "./admin-question-api";


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
  "Admin question API",
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });


    it(
      "loads the question bank through the same-origin proxy",
      async () => {
        const response = {
          items: [
            {
              question_id:
                "11111111-1111-4111-8111-111111111111",

              question_version_id:
                "22222222-2222-4222-8222-222222222222",

              version_number:
                2,

              question_preview:
                "Which Agile value best applies?",

              certification_id:
                "33333333-3333-4333-8333-333333333333",

              certification_name:
                "Agile Foundations",

              category_id:
                "44444444-4444-4444-8444-444444444444",

              category_name:
                "Agile Principles",

              difficulty:
                "medium",

              question_type:
                "multiple_choice",

              review_status:
                "approved",

              publication_status:
                "active",

              is_flagged:
                false,

              has_image:
                true,

              created_by_id:
                "55555555-5555-4555-8555-555555555555",

              last_updated:
                "2026-11-09T18:00:00Z",
            },
          ],

          count:
            1,
        };

        const mockFetch =
          mockResponse(
            200,
            response,
          );

        await expect(
          getManagedQuestions(
            "admin-token",
          ),
        ).resolves.toEqual(
          response,
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
          "/api/v1/admin/questions",
        );

        expect(
          options?.method,
        ).toBe(
          "GET",
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


    it(
      "encodes server-side question-bank filters and pagination",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              items: [],
              count: 0,
            },
          );

        await getManagedQuestions(
          "admin-token",
          {
            search:
              "  IAM policy  ",
            certification_id:
              "11111111-1111-4111-8111-111111111111",
            category_id:
              "22222222-2222-4222-8222-222222222222",
            difficulty:
              "hard",
            question_type:
              "multiple_choice",
            review_status:
              "approved",
            publication_status:
              "draft",
            has_image:
              true,
            page:
              3,
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
          "/api/v1/admin/questions",
        );

        expect(
          url.searchParams.get(
            "search",
          ),
        ).toBe(
          "IAM policy",
        );

        expect(
          url.searchParams.get(
            "certification_id",
          ),
        ).toBe(
          "11111111-1111-4111-8111-111111111111",
        );

        expect(
          url.searchParams.get(
            "category_id",
          ),
        ).toBe(
          "22222222-2222-4222-8222-222222222222",
        );

        expect(
          url.searchParams.get(
            "difficulty",
          ),
        ).toBe(
          "hard",
        );

        expect(
          url.searchParams.get(
            "question_type",
          ),
        ).toBe(
          "multiple_choice",
        );

        expect(
          url.searchParams.get(
            "review_status",
          ),
        ).toBe(
          "approved",
        );

        expect(
          url.searchParams.get(
            "publication_status",
          ),
        ).toBe(
          "draft",
        );

        expect(
          url.searchParams.get(
            "has_image",
          ),
        ).toBe(
          "true",
        );

        expect(
          url.searchParams.get(
            "page",
          ),
        ).toBe(
          "3",
        );

        expect(
          url.searchParams.get(
            "page_size",
          ),
        ).toBe(
          "50",
        );
      },
    );


    it(
      "surfaces forbidden access",
      async () => {
        mockResponse(
          403,
          {
            detail:
              "Insufficient permissions",
          },
        );

        await expect(
          getManagedQuestions(
            "learner-token",
          ),
        ).rejects.toMatchObject({
          name:
            "ApiError",

          status:
            403,
        });
      },
    );
  },
);
