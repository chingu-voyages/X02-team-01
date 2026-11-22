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
  revalidateQuestionImport,
  uploadQuestionImport,
  uploadQuestionImportAsset,
} from "@/lib/question-import-api";


const {
  mockedHandleError,
} = vi.hoisted(
  () => ({
    mockedHandleError:
      vi.fn(),
  }),
);


vi.mock(
  "@/features/auth/AuthProvider",
  () => ({
    useDemoSession: () => ({
      token:
        "contributor-token",
      role:
        "contributor",
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
    revalidateQuestionImport:
      vi.fn(),
    uploadQuestionImport:
      vi.fn(),
    uploadQuestionImportAsset:
      vi.fn(),
  }),
);


const mockedCancel =
  vi.mocked(
    cancelQuestionImport,
  );

const mockedCommit =
  vi.mocked(
    commitQuestionImport,
  );

const mockedGetBatch =
  vi.mocked(
    getQuestionImport,
  );

const mockedGetHistory =
  vi.mocked(
    getQuestionImportHistory,
  );

const mockedGetRows =
  vi.mocked(
    getQuestionImportRows,
  );

const mockedRevalidate =
  vi.mocked(
    revalidateQuestionImport,
  );

const mockedUpload =
  vi.mocked(
    uploadQuestionImport,
  );

const mockedUploadAsset =
  vi.mocked(
    uploadQuestionImportAsset,
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

const invalidBatch = {
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

const cancelledBatch = {
  ...invalidBatch,
  status:
    "cancelled" as const,
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

const readyHistoryItem = {
  ...readyBatch,
  uploaded_by_id:
    "55555555-5555-4555-8555-555555555555",
  uploaded_by_email:
    "contributor@example.test",
  uploaded_by_name:
    "Contributor One",
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

const certificationErrorRow = {
  ...readyRow,
  status:
    "invalid" as const,
  certification_code:
    "CS-DEMO",
  issues: [
    {
      sheet:
        "Questions",
      row:
        2,
      field:
        "certification_code",
      cell:
        "B2",
      severity:
        "error" as const,
      code:
        "CERTIFICATION_NOT_FOUND",
      message:
        "Certification code does not match an existing certification.",
      value_preview:
        "CS-DEMO",
      related_rows: [],
      asset_filename:
        null,
    },
  ],
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


function xlsxFile(
  name = "questions.xlsx",
) {
  return new File(
    ["xlsx"],
    name,
    {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}


beforeEach(() => {
  vi.clearAllMocks();

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

  mockedCancel
    .mockResolvedValue({
      batch:
        cancelledBatch,
      discarded_asset_count:
        0,
      already_cancelled:
        false,
    });

  mockedRevalidate
    .mockResolvedValue(
      readyBatch,
    );

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
      "shows recent imports and reopens a ready batch",
      async () => {
        const user =
          userEvent.setup();

        mockedGetHistory
          .mockResolvedValue({
            items: [
              readyHistoryItem,
            ],
            total:
              1,
            page:
              1,
            page_size:
              8,
          });

        render(
          <QuestionImportPage />,
        );

        expect(
          await screen.findByText(
            "questions.xlsx",
          ),
        ).toBeTruthy();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Continue",
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
      },
    );


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

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          xlsxFile(),
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
          await screen.findByRole(
            "heading",
            {
              name:
                "Ready to import",
            },
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
          await screen.findByRole(
            "heading",
            {
              name:
                "Import complete",
            },
          ),
        ).toBeTruthy();
      },
    );


    it(
      "groups repeated errors and cancels after confirmation",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValue(
            invalidBatch,
          );

        mockedGetRows
          .mockImplementation(
            async (
              _token,
              _batchId,
              query = {},
            ) => ({
              items: [
                certificationErrorRow,
              ],
              total:
                1,
              page:
                query.page ?? 1,
              page_size:
                query.page_size ?? 50,
            }),
          );

        render(
          <QuestionImportPage />,
        );

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          xlsxFile(),
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
          await screen.findAllByText(
            "CERTIFICATION_NOT_FOUND",
          ),
        ).toHaveLength(2);

        expect(
          screen.getByText(
            "Affects 1 row",
          ),
        ).toBeTruthy();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Cancel Import",
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
          ).getByText(
            "Cancel this import?",
          ),
        ).toBeTruthy();

        await user.click(
          within(
            dialog,
          ).getByRole(
            "button",
            {
              name:
                "Cancel Import",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedCancel,
            ).toHaveBeenCalledWith(
              "contributor-token",
              invalidBatch.id,
            );
          },
        );

        expect(
          await screen.findByRole(
            "heading",
            {
              name:
                "Import cancelled",
            },
          ),
        ).toBeTruthy();
      },
    );


    it(
      "revalidates a blocked batch after catalog changes",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValue(
            invalidBatch,
          );

        mockedGetRows
          .mockResolvedValue({
            items: [
              certificationErrorRow,
            ],
            total:
              1,
            page:
              1,
            page_size:
              50,
          });

        render(
          <QuestionImportPage />,
        );

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          xlsxFile(),
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
          await screen.findByRole(
            "heading",
            {
              name:
                "Import blocked",
            },
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

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Revalidate",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedRevalidate,
            ).toHaveBeenCalledWith(
              "contributor-token",
              invalidBatch.id,
            );
          },
        );

        expect(
          await screen.findByRole(
            "heading",
            {
              name:
                "Ready to import",
            },
          ),
        ).toBeTruthy();
      },
    );


    it(
      "cancels the old batch before validating a corrected workbook",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValueOnce(
            invalidBatch,
          )
          .mockResolvedValueOnce(
            readyBatch,
          );

        mockedGetRows
          .mockResolvedValue({
            items: [
              certificationErrorRow,
            ],
            total:
              1,
            page:
              1,
            page_size:
              50,
          });

        render(
          <QuestionImportPage />,
        );

        await user.upload(
          screen.getByLabelText(
            "Question bank workbook",
          ),
          xlsxFile(),
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

        await user.upload(
          screen.getByLabelText(
            "Corrected question bank workbook",
          ),
          xlsxFile(
            "questions-corrected.xlsx",
          ),
        );

        const dialog =
          screen.getByRole(
            "dialog",
          );

        expect(
          within(
            dialog,
          ).getByText(
            "Replace this import?",
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

        await user.click(
          within(
            dialog,
          ).getByRole(
            "button",
            {
              name:
                "Replace and Validate",
            },
          ),
        );

        await waitFor(
          () => {
            expect(
              mockedCancel,
            ).toHaveBeenCalledWith(
              "contributor-token",
              invalidBatch.id,
            );

            expect(
              mockedUpload,
            ).toHaveBeenLastCalledWith(
              "contributor-token",
              expect.objectContaining({
                name:
                  "questions-corrected.xlsx",
              }),
            );
          },
        );

        expect(
          await screen.findByText(
            "Corrected workbook uploaded and validated.",
          ),
        ).toBeTruthy();
      },
    );


    it(
      "shows missing image names and resolves them after image upload",
      async () => {
        const user =
          userEvent.setup();

        mockedUpload
          .mockResolvedValue(
            invalidBatch,
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
          xlsxFile(),
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
          await screen.findByRole(
            "heading",
            {
              name:
                "Ready to import",
            },
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
