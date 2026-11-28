import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
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

import QuestionImportPage from "./page";

import {
  cancelQuestionImport,
  commitQuestionImport,
  getQuestionImport,
  getQuestionImportHistory,
  getQuestionImportRows,
  publishQuestionImport,
  revalidateQuestionImport,
  uploadQuestionImport,
  uploadQuestionImportAsset,
} from "@/lib/question-import-api";


const {
  sessionState,
  mockedHandleError,
} = vi.hoisted(
  () => ({
    sessionState: {
      role:
        "administrator",
    },
    mockedHandleError:
      vi.fn(),
  }),
);


vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useDemoSession: () => ({
      token:
        "session-token",
      role:
        sessionState.role,
      ready:
        true,
      handleError:
        mockedHandleError,
    }),
  }),
);


vi.mock(
  "@/lib/question-import-api",
  () => ({
    cancelQuestionImport:
      vi.fn(),
    commitQuestionImport:
      vi.fn(),
    getQuestionImport:
      vi.fn(),
    getQuestionImportHistory:
      vi.fn(),
    getQuestionImportRows:
      vi.fn(),
    publishQuestionImport:
      vi.fn(),
    revalidateQuestionImport:
      vi.fn(),
    uploadQuestionImport:
      vi.fn(),
    uploadQuestionImportAsset:
      vi.fn(),
  }),
);


const mockedCommit =
  vi.mocked(
    commitQuestionImport,
  );

const mockedGetHistory =
  vi.mocked(
    getQuestionImportHistory,
  );

const mockedGetRows =
  vi.mocked(
    getQuestionImportRows,
  );

const mockedPublish =
  vi.mocked(
    publishQuestionImport,
  );

const mockedUpload =
  vi.mocked(
    uploadQuestionImport,
  );


const readyBatch = {
  id:
    "11111111-1111-4111-8111-111111111111",
  original_filename:
    "questions.xlsx",
  template_version:
    "2.0",
  status:
    "ready" as const,
  total_rows:
    2,
  valid_rows:
    2,
  error_rows:
    0,
  warning_rows:
    0,
  imported_rows:
    0,
  can_import:
    true,
  created_at:
    "2026-11-21T12:00:00Z",
  validated_at:
    "2026-11-21T12:00:01Z",
  imported_at:
    null,
};

const importedBatch = {
  ...readyBatch,
  status:
    "imported" as const,
  imported_rows:
    2,
  can_import:
    false,
  imported_at:
    "2026-11-21T12:05:00Z",
};

const rows = [
  {
    id:
      "22222222-2222-4222-8222-222222222222",
    row_number:
      2,
    status:
      "valid" as const,
    certification_code:
      "CS-100",
    category_name:
      "Programming Fundamentals",
    question_type:
      "multiple_choice",
    question_text:
      "What is a variable?",
    image_filename:
      null,
    issues: [],
  },
  {
    id:
      "33333333-3333-4333-8333-333333333333",
    row_number:
      3,
    status:
      "valid" as const,
    certification_code:
      "CS-100",
    category_name:
      "Data Structures",
    question_type:
      "multiple_choice",
    question_text:
      "What is a stack?",
    image_filename:
      null,
    issues: [],
  },
];


function workbookFile() {
  return new File(
    ["xlsx"],
    "questions.xlsx",
    {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}


async function completeImport() {
  const user =
    userEvent.setup();

  render(
    <QuestionImportPage />,
  );

  await user.upload(
    screen.getByLabelText(
      "Question bank workbook",
    ),
    workbookFile(),
  );

  await user.click(
    screen.getByRole(
      "button",
      {
        name:
          "Validate File",
      },
    ),
  );

  await user.click(
    await screen.findByRole(
      "button",
      {
        name:
          "Import 2 Questions",
      },
    ),
  );

  await screen.findByRole(
    "heading",
    {
      name:
        "Import complete",
    },
  );

  return user;
}


beforeEach(() => {
  vi.clearAllMocks();

  sessionState.role =
    "administrator";

  mockedGetHistory
    .mockResolvedValue({
      items: [],
      total:
        0,
      page:
        1,
      page_size:
        8,
    });

  mockedGetRows
    .mockImplementation(
      async (
        _token,
        _batchId,
        query = {},
      ) => ({
        items:
          query.row_status ===
          "invalid"
            ? []
            : rows,
        total:
          query.row_status ===
          "invalid"
            ? 0
            : rows.length,
        page:
          query.page ?? 1,
        page_size:
          query.page_size ?? 50,
      }),
    );

  mockedUpload
    .mockResolvedValue(
      readyBatch,
    );

  mockedCommit
    .mockResolvedValue({
      batch:
        importedBatch,
      created_count:
        2,
      created_question_ids: [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      already_imported:
        false,
    });

  mockedPublish
    .mockResolvedValue({
      batch:
        importedBatch,
      requested_count:
        2,
      published_count:
        2,
      already_published_count:
        0,
      published_question_ids: [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      already_published_question_ids: [],
      all_published:
        true,
    });

  vi.mocked(
    getQuestionImport,
  ).mockResolvedValue(
    importedBatch,
  );

  vi.mocked(
    cancelQuestionImport,
  ).mockResolvedValue({
    batch:
      importedBatch,
    discarded_asset_count:
      0,
    already_cancelled:
      false,
  });

  vi.mocked(
    revalidateQuestionImport,
  ).mockResolvedValue(
    readyBatch,
  );

  vi.mocked(
    uploadQuestionImportAsset,
  ).mockRejectedValue(
    new Error(
      "not used",
    ),
  );
});


afterEach(() => {
  cleanup();
});


describe(
  "QuestionImportPage bulk publication",
  () => {
    it(
      "lets an Administrator approve and publish the imported batch",
      async () => {
        const user =
          await completeImport();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Approve & Publish All 2",
            },
          ),
        );

        const dialog =
          screen.getByRole(
            "dialog",
          );

        expect(
          within(
            dialog,
          ).getByRole(
            "heading",
            {
              name:
                "Approve and publish 2 questions?",
            },
          ),
        ).toBeTruthy();

        expect(
          within(
            dialog,
          ).getByText(
            "This does not publish the certification or categories.",
            {
              exact:
                true,
            },
          ),
        ).toBeTruthy();

        await user.click(
          within(
            dialog,
          ).getByRole(
            "button",
            {
              name:
                "Publish 2 Questions",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedPublish,
            ).toHaveBeenCalledWith(
              "session-token",
              importedBatch.id,
            );
          },
        );

        expect(
          await screen.findByRole(
            "heading",
            {
              name:
                "Publication complete",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "2 questions were newly approved and published.",
            {
              exact:
                true,
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Approve & Publish All 2",
            },
          ),
        ).toBeNull();
      },
    );


    it(
      "keeps publication unavailable to a Contributor",
      async () => {
        sessionState.role =
          "contributor";

        await completeImport();

        expect(
          screen.getByText(
            "This import created drafts. Open the Question Bank to submit any remaining drafts for administrator review.",
            {
              exact:
                true,
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByRole(
            "button",
            {
              name:
                "Approve & Publish All 2",
            },
          ),
        ).toBeNull();

        expect(
          mockedPublish,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
