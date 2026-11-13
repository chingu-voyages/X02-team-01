import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createAdminCategory,
  createAdminCertification,
  getAdminCategories,
  getAdminCertifications,
  getAdminQuestionCategories,
  setAdminCategoryPublication,
  setAdminCertificationPublication,
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
      "loads certifications",
      async () => {
        const certification = {
          id:
            "11111111-1111-4111-8111-111111111111",
          name:
            "AWS Cloud Practitioner",
          code: "CLF-C02",
          passing_threshold_pct:
            70,
          feedback_mode:
            "immediate",
          is_published:
            false,
        };

        const mockFetch =
          mockResponse(
            200,
            {
              items: [
                certification,
              ],
              count: 1,
            },
          );

        await expect(
          getAdminCertifications(
            "admin-token",
          ),
        ).resolves.toEqual([
          certification,
        ]);

        const [
          url,
          options,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/certifications",
        );

        expect(
          options?.method,
        ).toBe("GET");
      },
    );

    it(
      "creates a certification",
      async () => {
        const created = {
          id:
            "11111111-1111-4111-8111-111111111111",
          name:
            "AWS Cloud Practitioner",
          code: "CLF-C02",
          passing_threshold_pct:
            70,
          feedback_mode:
            "immediate",
          is_published:
            false,
        };

        const mockFetch =
          mockResponse(
            201,
            created,
          );

        await createAdminCertification(
          "admin-token",
          {
            name:
              "AWS Cloud Practitioner",
            code:
              "CLF-C02",
            passing_threshold_pct:
              70,
            feedback_mode:
              "immediate",
          },
        );

        const [
          url,
          options,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/certifications",
        );

        expect(
          options?.method,
        ).toBe("POST");

        expect(
          JSON.parse(
            String(
              options?.body,
            ),
          ),
        ).toEqual({
          name:
            "AWS Cloud Practitioner",
          code:
            "CLF-C02",
          passing_threshold_pct:
            70,
          feedback_mode:
            "immediate",
        });
      },
    );

    it(
      "publishes a certification",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {},
          );

        await setAdminCertificationPublication(
          "admin-token",
          "11111111-1111-4111-8111-111111111111",
          true,
        );

        const [
          url,
          options,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/certifications/11111111-1111-4111-8111-111111111111/publication",
        );

        expect(
          options?.method,
        ).toBe("PATCH");

        expect(
          JSON.parse(
            String(
              options?.body,
            ),
          ),
        ).toEqual({
          is_published: true,
        });
      },
    );

    it(
      "loads published and unpublished categories",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {
              items: [
                {
                  id:
                    "22222222-2222-4222-8222-222222222222",
                  certification_id:
                    "11111111-1111-4111-8111-111111111111",
                  certification_name:
                    "Agile Foundations",
                  name:
                    "Draft Category",
                  is_published:
                    false,
                },
                {
                  id:
                    "33333333-3333-4333-8333-333333333333",
                  certification_id:
                    "11111111-1111-4111-8111-111111111111",
                  certification_name:
                    "Agile Foundations",
                  name:
                    "Published Category",
                  is_published:
                    true,
                },
              ],
              count: 2,
            },
          );

        const result =
          await getAdminCategories(
            "admin-token",
          );

        expect(
          result,
        ).toHaveLength(2);

        const [
          url,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/categories",
        );
      },
    );

    it(
      "creates a category",
      async () => {
        const mockFetch =
          mockResponse(
            201,
            {},
          );

        await createAdminCategory(
          "admin-token",
          {
            certification_id:
              "11111111-1111-4111-8111-111111111111",
            name:
              "Scrum Fundamentals",
          },
        );

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
        ).toBe("POST");

        expect(
          JSON.parse(
            String(
              options?.body,
            ),
          ),
        ).toEqual({
          certification_id:
            "11111111-1111-4111-8111-111111111111",
          name:
            "Scrum Fundamentals",
        });
      },
    );

    it(
      "publishes a category",
      async () => {
        const mockFetch =
          mockResponse(
            200,
            {},
          );

        await setAdminCategoryPublication(
          "admin-token",
          "22222222-2222-4222-8222-222222222222",
          true,
        );

        const [
          url,
          options,
        ] =
          mockFetch.mock.calls[0];

        expect(url).toBe(
          "http://localhost:8000/api/v1/admin/categories/22222222-2222-4222-8222-222222222222/publication",
        );

        expect(
          options?.method,
        ).toBe("PATCH");

        expect(
          JSON.parse(
            String(
              options?.body,
            ),
          ),
        ).toEqual({
          is_published: true,
        });
      },
    );

    it(
      "maps admin categories for the question editor",
      async () => {
        mockResponse(
          200,
          {
            items: [
              {
                id:
                  "22222222-2222-4222-8222-222222222222",
                certification_id:
                  "11111111-1111-4111-8111-111111111111",
                certification_name:
                  "Agile Foundations",
                name:
                  "Draft Category",
                is_published:
                  false,
              },
            ],
            count: 1,
          },
        );

        await expect(
          getAdminQuestionCategories(
            "admin-token",
          ),
        ).resolves.toEqual([
          {
            id:
              "22222222-2222-4222-8222-222222222222",
            certification_id:
              "11111111-1111-4111-8111-111111111111",
            certification_name:
              "Agile Foundations",
            name:
              "Draft Category",
            available_question_count:
              0,
          },
        ]);
      },
    );

    it(
      "surfaces forbidden catalog writes",
      async () => {
        mockResponse(
          403,
          {
            detail:
              "Insufficient permissions",
          },
        );

        await expect(
          createAdminCategory(
            "contributor-token",
            {
              certification_id:
                "11111111-1111-4111-8111-111111111111",
              name:
                "Restricted",
            },
          ),
        ).rejects.toMatchObject(
          {
            name:
              "ApiError",
            status:
              403,
          },
        );
      },
    );
  },
);