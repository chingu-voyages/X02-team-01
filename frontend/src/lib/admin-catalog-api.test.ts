import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAdminQuestionCategories,
} from "./admin-catalog-api";

function mockResponse(
  status: number,
  body: unknown,
) {
  const mockFetch =
    vi.fn<typeof fetch>().mockResolvedValue(
      {
        ok:
          status >= 200 &&
          status < 300,
        status,
        json: async () => body,
      } as Response,
    );

  vi.stubGlobal(
    "fetch",
    mockFetch,
  );

  return mockFetch;
}

describe(
  "Admin catalog API",
  () => {
    beforeEach(() => {
      vi.stubEnv(
        "NEXT_PUBLIC_API_URL",
        "http://localhost:8000/api/v1",
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it(
      "loads published and unpublished admin categories",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              items: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  certification_id:
                    "22222222-2222-4222-8222-222222222222",
                  certification_name:
                    "Agile Foundations",
                  name:
                    "Draft Category",
                  is_published: false,
                },
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  certification_id:
                    "22222222-2222-4222-8222-222222222222",
                  certification_name:
                    "Agile Foundations",
                  name:
                    "Published Category",
                  is_published: true,
                },
              ],
              count: 2,
            },
          );

        const result =
          await getAdminQuestionCategories(
            "admin-token",
          );

        expect(result).toEqual([
          {
            id: "11111111-1111-4111-8111-111111111111",
            certification_id:
              "22222222-2222-4222-8222-222222222222",
            certification_name:
              "Agile Foundations",
            name:
              "Draft Category",
            available_question_count:
              0,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            certification_id:
              "22222222-2222-4222-8222-222222222222",
            certification_name:
              "Agile Foundations",
            name:
              "Published Category",
            available_question_count:
              0,
          },
        ]);

        const [
          url,
          options,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/categories",
        );

        expect(
          options?.method,
        ).toBe("GET");

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
      "handles an empty admin category catalog",
      async () => {
        mockResponse(
          200,
          {
            items: [],
            count: 0,
          },
        );

        await expect(
          getAdminQuestionCategories(
            "admin-token",
          ),
        ).resolves.toEqual(
          [],
        );
      },
    );

    it(
      "surfaces forbidden admin catalog access",
      async () => {
        mockResponse(
          403,
          {
            detail:
              "Insufficient permissions",
          },
        );

        await expect(
          getAdminQuestionCategories(
            "learner-token",
          ),
        ).rejects.toMatchObject(
          {
            name: "ApiError",
            status: 403,
          },
        );
      },
    );

    it(
      "rejects a missing bearer token before fetching",
      async () => {
        const mockFetch =
          vi.fn<typeof fetch>();

        vi.stubGlobal(
          "fetch",
          mockFetch,
        );

        await expect(
          getAdminQuestionCategories(
            "",
          ),
        ).rejects.toMatchObject(
          {
            status: 401,
          },
        );

        expect(
          mockFetch,
        ).not.toHaveBeenCalled();
      },
    );
  },
);