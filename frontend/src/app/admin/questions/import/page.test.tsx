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

import QuestionImportPage from "./page";

import {
  commitQuestionImport,
  getQuestionImport,
  getQuestionImportRows,
  uploadQuestionImport,
  uploadQuestionImportAsset,
} from "@/lib/question-import-api";


vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useDemoSession: () => ({
      token:
        "contributor-token",
      ready:
        true,
      handleError:
        vi.fn(),
    }),
  }),
);

vi.mock(
  "@/lib/question-import-api",
  () => ({
    uploadQuestionImport:
      vi.fn(),
    getQuestionImport:
      vi.fn(),
    getQuestionImportRows:
      vi.fn(),
    uploadQuestionImportAsset:
      vi.fn(),
    commitQuestionImport:
      vi.fn(),
  }),
);


const mockedUpload =
  vi.mocked(
    uploadQuestionImport,
  );

const mockedGetBatch =
  vi.mocked(
    getQuestionImport,
  );

const mockedGetRows =
  vi.mocked(
    getQuestionImportRows,
  );

const mockedUploadAsset =
  vi.mocked(
    uploadQuestionImportAsset,
  );

const mockedCommit =
  vi.mocked(
    commitQuestionImport,
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
    1,
  valid_rows:
    1,
  error_rows:
    0,
  warning_rows:
    0,
  imported_rows:
    0,
  can_import:
    true,
  created_at:
    "2026-11-18T12:00:00Z",
  validated_at:
    "2026-11-18T12:00:01Z",
  imported_at:
    null,
};

const invalidImageBatch = {
  ...readyBatch,
  status:
    "invalid" as const,
  valid_rows:
    0,
  error_rows:
    1,
  can_import:
    false,
};

const importedBatch = {
  ...readyBatch,
  status:
    "imported" as const,
  imported_rows:
    1,
  imported_at:
    "2026-11-18T12:05:00Z",
};

const readyRow = {
  id:
    "22222222-2222-4222-8222-222222222222",
  row_number:
    2,
  status:
    "valid" as const,
  certification_code:
    "CLF-C02",
  category_name:
    "Security",
  question_type:
    "multiple_choice",
  question_text:
    "What is IAM?",
  image_filename:
    null,
  issues: [],
};

const missingImageRow = {
  ...readyRow,
  status:
    "invalid" as const,
  image_filename:
    "vpc.png",
  issues: [
    {
      sheet:
        "Questions",
      row:
        2,
      field:
        "image_filename",
      cell:
        null,
      severity:
        "error" as const,
      code:
        "MISSING_IMAGE_FILE",
      message:
        "Referenced image file has not been supplied to this import batch.",
      value_preview:
        null,
      related_rows: [],
      asset_filename:
        "vpc.png",
    },
  ],
};


beforeEach(() => {
  vi.clearAllMocks();

  mockedGetBatch
    .mockResolvedValue(
      readyBatch,
    );

  mockedGetRows
    .mockResolvedValue({
      items: [
        readyRow,
      ],
      total:
        1,
      page:
        1,
      page_size:
        50,
    });

  mockedUploadAsset
    .mockResolvedValue({
      asset: {
        id:
          "33333333-3333-4333-8333-333333333333",
        source_filename:
          "vpc.png",
        media_type:
          "image/png",
        byte_size:
          100,
        status:
          "valid",
      },
      batch:
        readyBatch,
    });

  mockedCommit
    .mockResolvedValue({
      batch:
        importedBatch,
      created_count:
        1,
      created_question_ids: [
        "44444444-4444-4444-8444-444444444444",
      ],
      already_imported:
        false,
    });
});


afterEach(() => {
  cleanup();
});


describe(
  "QuestionImportPage",
  () => {
    it(
      "uploads a workbook, previews rows, and confirms the import",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValue(
            readyBatch,
          );

        render(
          <QuestionImportPage />,
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

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          file,
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

        expect(
          await screen.findByText(
            "What is IAM?",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "Ready to import",
          ),
        ).toBeTruthy();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Import 1 Questions",
            },
          ),
        );

        expect(
          await screen.findByText(
            "Import complete",
          ),
        ).toBeTruthy();

        expect(
          mockedCommit,
        ).toHaveBeenCalledWith(
          "contributor-token",
          readyBatch.id,
        );
      },
    );


    it(
      "shows missing image names and resolves them after image upload",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValue(
            invalidImageBatch,
          );

        mockedGetRows
          .mockImplementation(
            async (
              _token,
              _batchId,
              query = {},
            ) => {
              if (
                query.row_status ===
                "invalid"
              ) {
                return {
                  items: [
                    missingImageRow,
                  ],
                  total:
                    1,
                  page:
                    1,
                  page_size:
                    100,
                };
              }

              return {
                items: [
                  missingImageRow,
                ],
                total:
                  1,
                page:
                  1,
                page_size:
                  50,
              };
            },
          );

        mockedGetBatch
          .mockResolvedValue(
            readyBatch,
          );

        render(
          <QuestionImportPage />,
        );

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          new File(
            ["xlsx"],
            "questions.xlsx",
            {
              type:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ),
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

        expect(
          (
            await screen.findAllByText(
              "vpc.png",
            )
          ).length,
        ).toBeGreaterThan(0);

        expect(
          screen.getByText(
            "Import blocked",
          ),
        ).toBeTruthy();

        mockedGetRows
          .mockResolvedValue({
            items: [
              readyRow,
            ],
            total:
              1,
            page:
              1,
            page_size:
              50,
          });

        await user.upload(
          screen.getByLabelText(
            "Import images",
          ),
          new File(
            ["png"],
            "vpc.png",
            {
              type:
                "image/png",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedUploadAsset,
            ).toHaveBeenCalled();
          },
        );

        expect(
          await screen.findByText(
            "Ready to import",
          ),
        ).toBeTruthy();
      },
    );


    it(
      "rejects non-XLSX files before calling the API",
      async () => {
        const user =
          userEvent.setup({
            applyAccept:
              false,
          });

        render(
          <QuestionImportPage />,
        );

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          new File(
            ["csv"],
            "questions.csv",
            {
              type:
                "text/csv",
            },
          ),
        );

        const alert =
          await screen.findByRole(
            "alert",
          );

        expect(
          alert.textContent,
        ).toContain(
          "approved .xlsx",
        );

        expect(
          mockedUpload,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
