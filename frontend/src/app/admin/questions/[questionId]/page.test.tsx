import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import AdminQuestionDetailPage from "./page";

import {
  getManagedQuestion,
} from "@/lib/admin-question-api";


const contributorToken =
  "header.eyJyb2xlIjoiY29udHJpYnV0b3IifQ.signature";


vi.mock(
  "next/navigation",
  () => ({
    useParams: () => ({
      questionId:
        "33333333-3333-4333-8333-333333333333",
    }),
  }),
);


vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useDemoSession: () => ({
      token:
        "header.eyJyb2xlIjoiY29udHJpYnV0b3IifQ.signature",
      ready:
        true,
      handleError:
        vi.fn(),
    }),
  }),
);


vi.mock(
  "@/lib/admin-question-api",
  () => ({
    getManagedQuestion:
      vi.fn(),
    publishManagedQuestion:
      vi.fn(),
    rejectManagedQuestion:
      vi.fn(),
    retireManagedQuestion:
      vi.fn(),
  }),
);


const mockedGetQuestion =
  vi.mocked(
    getManagedQuestion,
  );


const rejectedQuestion = {
  question_id:
    "33333333-3333-4333-8333-333333333333",
  question_version_id:
    "44444444-4444-4444-8444-444444444444",
  version_number:
    1,
  certification_id:
    "11111111-1111-4111-8111-111111111111",
  certification_name:
    "AWS Cloud Practitioner",
  category_id:
    "22222222-2222-4222-8222-222222222222",
  category_name:
    "Security",
  difficulty:
    "medium" as const,
  question_text:
    "What is IAM?",
  question_type:
    "multiple_choice" as const,
  allows_multiple_answers:
    false,
  explanation:
    "IAM manages access.",
  review_status:
    "rejected" as const,
  publication_status:
    "draft" as const,
  review_note:
    "Please clarify why option B is incorrect.",
  is_flagged:
    false,
  created_by_id:
    "55555555-5555-4555-8555-555555555555",
  submitted_by_id:
    "55555555-5555-4555-8555-555555555555",
  last_updated:
    "2026-11-19T20:00:00Z",
  options: [
    {
      position:
        1,
      option_text:
        "Identity and Access Management",
      is_correct:
        true,
    },
    {
      position:
        2,
      option_text:
        "Object storage",
      is_correct:
        false,
    },
  ],
  expected_answer:
    null,
  max_points: null,
  criteria_markdown: null,
  rubric: [],
  images: [],
};


beforeEach(() => {
  vi.clearAllMocks();

  mockedGetQuestion
    .mockResolvedValue(
      rejectedQuestion,
    );
});


afterEach(() => {
  cleanup();
});


describe(
  "AdminQuestionDetailPage rejection feedback",
  () => {
    it(
      "shows administrator feedback to the owning contributor",
      async () => {
        render(
          <AdminQuestionDetailPage />,
        );

        expect(
          await screen.findByText(
            "Administrator feedback",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "Please clarify why option B is incorrect.",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            /REJECTED — edit this question/,
          ),
        ).toBeTruthy();

        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Approve & Publish",
            },
          ),
        ).toBeNull();

        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Reject",
            },
          ),
        ).toBeNull();

        await waitFor(
          () => {
            expect(
              mockedGetQuestion,
            ).toHaveBeenCalledWith(
              contributorToken,
              rejectedQuestion.question_id,
            );
          },
        );
      },
    );
  },
);
