import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { loginMfaAdministrator } from "./helpers/admin-mfa";

import {
  Workbook,
  type Worksheet,
} from "exceljs";


const contributorEmail =
  process.env
    .E2E_CONTRIBUTOR_EMAIL ??
  "jhep29-demo-learner@example.test";

const contributorPassword =
  process.env
    .E2E_CONTRIBUTOR_PASSWORD ??
  "DemoL3arner!";

const certificationCode =
  "JHEP29-DEMO-SECPLUS";

const categoryName =
  "Core concepts";

const importHeaders = [
  "template_version",
  "certification_code",
  "category_name",
  "difficulty",
  "question_type",
  "allows_multiple_answers",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "option_f",
  "correct_answers",
  "expected_answer",
  "explanation",
  "image_filename",
  "image_alt_text",
] as const;


type AdminUsersPage = {
  items: Array<{
    id: string;
    email: string;
    role:
      | "learner"
      | "contributor"
      | "administrator";
  }>;
};

type RecoveryFixture = {
  invalidWorkbookPath: string;
  invalidWorkbookName: string;
  correctedWorkbookPath: string;
  correctedWorkbookName: string;
  runId: string;
};


async function responseJson<T>(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  context: string,
): Promise<T> {
  if (
    !response.ok()
  ) {
    throw new Error(
      `${context} failed with HTTP ${response.status()}: ` +
        (await response.text()),
    );
  }

  return (
    await response.json()
  ) as T;
}


async function ensureContributor(
  request: APIRequestContext,
) {
  const admin = await loginMfaAdministrator(request);

  const authorization = {
    Authorization:
      `Bearer ${admin.access_token}`,
  };

  const usersResponse =
    await request.get(
      "/api/v1/admin/users",
      {
        headers:
          authorization,
        params: {
          q:
            contributorEmail,
          limit:
            "20",
          offset:
            "0",
        },
      },
    );

  const users =
    await responseJson<AdminUsersPage>(
      usersResponse,
      "Users & Access lookup",
    );

  const target =
    users.items.find(
      (user) =>
        user.email ===
        contributorEmail,
    );

  if (!target) {
    throw new Error(
      "Seeded demo learner was not found.",
    );
  }

  if (
    target.role ===
    "contributor"
  ) {
    return;
  }

  const change =
    await request.patch(
      `/api/v1/admin/users/${target.id}/role`,
      {
        headers:
          authorization,
        data: {
          role:
            "contributor",
        },
      },
    );

  if (
    !change.ok()
  ) {
    throw new Error(
      "Unable to promote the seeded demo learner: " +
        (await change.text()),
    );
  }
}


async function loginAsContributor(
  page: Page,
) {
  await page.goto(
    "/login",
  );

  await page
    .getByLabel(
      "Email address",
    )
    .fill(
      contributorEmail,
    );

  await page
    .getByLabel(
      "Password",
      {
        exact:
          true,
      },
    )
    .fill(
      contributorPassword,
    );

  await page
    .getByRole(
      "button",
      {
        name:
          "Sign in",
        exact:
          true,
      },
    )
    .click();

  await expect(
    page,
  ).toHaveURL(
    /\/admin\/questions$/,
  );
}


function runIdFor(
  testInfo: TestInfo,
) {
  return (
    `JHEP189-E2E-` +
    `${Date.now()}-` +
    `${testInfo.workerIndex}`
  );
}


function addQuestionRow(
  sheet: Worksheet,
  {
    certification,
    questionText,
  }: {
    certification: string;
    questionText: string;
  },
) {
  sheet.addRow([
    "2.0",
    certification,
    categoryName,
    "easy",
    "multiple_choice",
    false,
    questionText,
    "Correct",
    "Incorrect",
    null,
    null,
    null,
    null,
    "A",
    null,
    "Recovery workflow E2E question.",
    null,
    null,
  ]);
}


async function writeWorkbook(
  outputPath: string,
  rows: Array<{
    certification: string;
    questionText: string;
  }>,
) {
  const workbook =
    new Workbook();

  const sheet =
    workbook.addWorksheet(
      "Questions",
    );

  sheet.addRow(
    [...importHeaders],
  );

  for (const row of rows) {
    addQuestionRow(
      sheet,
      row,
    );
  }

  await workbook.xlsx.writeFile(
    outputPath,
  );
}


async function createRecoveryFixture(
  testInfo: TestInfo,
): Promise<RecoveryFixture> {
  const runId =
    runIdFor(
      testInfo,
    );

  const invalidWorkbookName =
    `jhep-189-invalid-${runId}.xlsx`;

  const correctedWorkbookName =
    `jhep-189-corrected-${runId}.xlsx`;

  const invalidWorkbookPath =
    testInfo.outputPath(
      invalidWorkbookName,
    );

  const correctedWorkbookPath =
    testInfo.outputPath(
      correctedWorkbookName,
    );

  const firstQuestion =
    `${runId} — valid row that must never partially persist`;

  const secondQuestion =
    `${runId} — corrected catalog reference`;

  await writeWorkbook(
    invalidWorkbookPath,
    [
      {
        certification:
          certificationCode,
        questionText:
          firstQuestion,
      },
      {
        certification:
          "CERTIFICATION-DOES-NOT-EXIST",
        questionText:
          secondQuestion,
      },
    ],
  );

  await writeWorkbook(
    correctedWorkbookPath,
    [
      {
        certification:
          certificationCode,
        questionText:
          firstQuestion,
      },
      {
        certification:
          certificationCode,
        questionText:
          secondQuestion,
      },
    ],
  );

  return {
    invalidWorkbookPath,
    invalidWorkbookName,
    correctedWorkbookPath,
    correctedWorkbookName,
    runId,
  };
}


async function confirmCancel(
  page: Page,
) {
  await page
    .getByRole(
      "button",
      {
        name:
          "Cancel Import",
        exact:
          true,
      },
    )
    .click();

  const dialog =
    page.getByRole(
      "dialog",
    );

  await expect(
    dialog.getByRole(
      "heading",
      {
        name:
          "Cancel this import?",
      },
    ),
  ).toBeVisible();

  await dialog
    .getByRole(
      "button",
      {
        name:
          "Cancel Import",
        exact:
          true,
      },
    )
    .click();

  await expect(
    page.getByRole(
      "heading",
      {
        name:
          "Import cancelled",
        exact:
          true,
      },
    ),
  ).toBeVisible({
    timeout:
      30_000,
  });
}


test.describe.serial(
  "JHEP-189 import recovery workflow",
  () => {
    test.beforeEach(
      async ({
        request,
      }) => {
        await ensureContributor(
          request,
        );
      },
    );


    test(
      "Contributor cancels, reactivates, revalidates and replaces a blocked import",
      async ({
        page,
      }, testInfo) => {
        const fixture =
          await createRecoveryFixture(
            testInfo,
          );

        await loginAsContributor(
          page,
        );

        await page.goto(
          "/admin/questions/import",
        );

        await page
          .getByLabel(
            "Question bank workbook",
          )
          .setInputFiles(
            fixture.invalidWorkbookPath,
          );

        await page
          .getByRole(
            "button",
            {
              name:
                "Validate File",
            },
          )
          .click();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Import blocked",
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Issues to resolve",
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByText(
            "CERTIFICATION_NOT_FOUND",
            {
              exact:
                true,
            },
          ).first(),
        ).toBeVisible();

        await expect(
          page.getByText(
            "Affects 1 row",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible();

        await page
          .getByRole(
            "button",
            {
              name:
                "Revalidate",
              exact:
                true,
            },
          )
          .click();

        await expect(
          page.getByText(
            "Validation refreshed. Some issues still need attention.",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible({
          timeout:
            30_000,
        });

        await confirmCancel(
          page,
        );

        await expect(
          page.getByText(
            "Import cancelled. No questions were created.",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "button",
            {
              name:
                "Revalidate",
              exact:
                true,
            },
          ),
        ).toHaveCount(
          0,
        );

        await page
          .getByRole(
            "button",
            {
              name:
                "Start New Import",
              exact:
                true,
            },
          )
          .click();

        const historyFilename =
          page.getByText(
            fixture.invalidWorkbookName,
            {
              exact:
                true,
            },
          );

        await expect(
          historyFilename,
        ).toBeVisible({
          timeout:
            30_000,
        });

        const historyItem =
          historyFilename.locator(
            "xpath=ancestor::div[.//button[normalize-space()='View']][1]",
          );

        await expect(
          historyItem.getByText(
            "Cancelled",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible();

        // Re-uploading the exact cancelled workbook exercises same-hash
        // reactivation instead of returning a permanently stuck batch.
        await page
          .getByLabel(
            "Question bank workbook",
          )
          .setInputFiles(
            fixture.invalidWorkbookPath,
          );

        await page
          .getByRole(
            "button",
            {
              name:
                "Validate File",
            },
          )
          .click();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Import blocked",
            },
          ),
        ).toBeVisible({
          timeout:
            30_000,
        });

        await page
          .getByLabel(
            "Corrected question bank workbook",
          )
          .setInputFiles(
            fixture.correctedWorkbookPath,
          );

        const replaceDialog =
          page.getByRole(
            "dialog",
          );

        await expect(
          replaceDialog.getByRole(
            "heading",
            {
              name:
                "Replace this import?",
            },
          ),
        ).toBeVisible();

        await expect(
          replaceDialog.getByText(
            fixture.correctedWorkbookName,
            {
              exact:
                true,
            },
          ),
        ).toBeVisible();

        await replaceDialog
          .getByRole(
            "button",
            {
              name:
                "Replace and Validate",
              exact:
                true,
            },
          )
          .click();

        await expect(
          page.getByText(
            "Corrected workbook uploaded and validated.",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible({
          timeout:
            30_000,
        });

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Ready to import",
            },
          ),
        ).toBeVisible();

        // Clean up the ready batch and prove recovery never created
        // partial Question rows.
        await confirmCancel(
          page,
        );

        await page
          .getByRole(
            "link",
            {
              name:
                "Back to Question Bank",
            },
          )
          .click();

        const search =
          page.getByPlaceholder(
            /Search question text/i,
          );

        await search.fill(
          fixture.runId,
        );

        await expect(
          page.getByText(
            "No questions match the current filters.",
            {
              exact:
                true,
            },
          ),
        ).toBeVisible({
          timeout:
            15_000,
        });
      },
    );
  },
);
