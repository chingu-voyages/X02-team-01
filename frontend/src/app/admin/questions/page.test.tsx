import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import AdminQuestionsPage from "./page";

import {
  getAdminCategories,
  getAdminCertifications,
} from "@/lib/admin-catalog-api";

import {
  getManagedQuestions,
} from "@/lib/admin-question-api";

const {
  mockHandleError,
} = vi.hoisted(() => ({
  mockHandleError:
    vi.fn(),
}));

vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useDemoSession: () => ({
      token:
        "admin-token",
      ready:
        true,
      handleError:
        mockHandleError,
    }),
  }),
);

vi.mock(
  "@/lib/admin-question-api",
  () => ({
    getManagedQuestions:
      vi.fn(),
  }),
);

vi.mock(
  "@/lib/admin-catalog-api",
  () => ({
    getAdminCertifications:
      vi.fn(),
    getAdminCategories:
      vi.fn(),
  }),
);

const mockedGetQuestions =
  vi.mocked(
    getManagedQuestions,
  );

const mockedGetCertifications =
  vi.mocked(
    getAdminCertifications,
  );

const mockedGetCategories =
  vi.mocked(
    getAdminCategories,
  );

const certification = {
  id:
    "11111111-1111-4111-8111-111111111111",
  name:
    "AWS Cloud Practitioner",
  code:
    "CLF-C02",
  passing_threshold_pct:
    70,
  feedback_mode:
    "immediate" as const,
  is_published:
    true,
};

const category = {
  id:
    "22222222-2222-4222-8222-222222222222",
  certification_id:
    certification.id,
  certification_name:
    certification.name,
  name:
    "Security",
  is_published:
    true,
};

const question = {
  question_id:
    "33333333-3333-4333-8333-333333333333",
  question_version_id:
    "44444444-4444-4444-8444-444444444444",
  version_number:
    1,
  question_preview:
    "What is AWS IAM?",
  certification_id:
    certification.id,
  certification_name:
    certification.name,
  category_id:
    category.id,
  category_name:
    category.name,
  difficulty:
    "medium" as const,
  question_type:
    "multiple_choice" as const,
  review_status:
    "pending" as const,
  publication_status:
    "draft" as const,
  is_flagged:
    false,
  has_image:
    true,
  created_by_id:
    "55555555-5555-4555-8555-555555555555",
  last_updated:
    "2026-11-18T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();

  mockedGetCertifications
    .mockResolvedValue([
      certification,
    ]);

  mockedGetCategories
    .mockResolvedValue([
      category,
    ]);

  mockedGetQuestions
    .mockResolvedValue({
      items: [
        question,
      ],
      count:
        76,
    });
});

afterEach(() => {
  cleanup();
});

describe(
  "AdminQuestionsPage",
  () => {
    it(
      "loads the first server page and real catalog filters",
      async () => {
        render(
          <AdminQuestionsPage />,
        );

        expect(
          await screen.findByText(
            "What is AWS IAM?",
          ),
        ).toBeTruthy();

        expect(
          mockedGetQuestions,
        ).toHaveBeenCalledWith(
          "admin-token",
          expect.objectContaining({
            page:
              1,
            page_size:
              50,
          }),
        );

        expect(
          mockedGetCertifications,
        ).toHaveBeenCalledWith(
          "admin-token",
        );

        expect(
          mockedGetCategories,
        ).toHaveBeenCalledWith(
          "admin-token",
        );

        expect(
          screen.getByText(
            "Showing 1–50 of 76 questions",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "1 / 2",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "Image",
          ),
        ).toBeTruthy();
      },
    );


    it(
      "requests the next page from the backend",
      async () => {
        const user =
          userEvent.setup();

        render(
          <AdminQuestionsPage />,
        );

        await screen.findByText(
          "What is AWS IAM?",
        );

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Next page",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedGetQuestions,
            ).toHaveBeenLastCalledWith(
              "admin-token",
              expect.objectContaining({
                page:
                  2,
                page_size:
                  50,
              }),
            );
          },
        );
      },
    );


    it(
      "sends certification and category IDs to the server",
      async () => {
        const user =
          userEvent.setup();

        render(
          <AdminQuestionsPage />,
        );

        await screen.findByText(
          "What is AWS IAM?",
        );

        await user.selectOptions(
          screen.getByLabelText(
            "Certification",
          ),
          certification.id,
        );

        await waitFor(
          () => {
            expect(
              mockedGetQuestions,
            ).toHaveBeenLastCalledWith(
              "admin-token",
              expect.objectContaining({
                certification_id:
                  certification.id,
                page:
                  1,
              }),
            );
          },
        );

        await user.selectOptions(
          screen.getByLabelText(
            "Category",
          ),
          category.id,
        );

        await waitFor(
          () => {
            expect(
              mockedGetQuestions,
            ).toHaveBeenLastCalledWith(
              "admin-token",
              expect.objectContaining({
                certification_id:
                  certification.id,
                category_id:
                  category.id,
                page:
                  1,
              }),
            );
          },
        );
      },
    );


    it(
      "maps workflow and media filters to backend query fields",
      async () => {
        const user =
          userEvent.setup();

        render(
          <AdminQuestionsPage />,
        );

        await screen.findByText(
          "What is AWS IAM?",
        );

        await user.selectOptions(
          screen.getByLabelText(
            "Workflow status",
          ),
          "approved_draft",
        );

        await user.selectOptions(
          screen.getByLabelText(
            "Media",
          ),
          "with_image",
        );

        await waitFor(
          () => {
            expect(
              mockedGetQuestions,
            ).toHaveBeenLastCalledWith(
              "admin-token",
              expect.objectContaining({
                review_status:
                  "approved",
                publication_status:
                  "draft",
                has_image:
                  true,
                page:
                  1,
              }),
            );
          },
        );
      },
    );


    it(
      "debounces search before requesting the server",
      async () => {
        const user =
          userEvent.setup();

        render(
          <AdminQuestionsPage />,
        );

        await screen.findByText(
          "What is AWS IAM?",
        );

        await user.type(
          screen.getByRole(
            "searchbox",
          ),
          "IAM",
        );

        await waitFor(
          () => {
            expect(
              mockedGetQuestions,
            ).toHaveBeenLastCalledWith(
              "admin-token",
              expect.objectContaining({
                search:
                  "IAM",
                page:
                  1,
              }),
            );
          },
          {
            timeout:
              1000,
          },
        );
      },
    );
  },
);
