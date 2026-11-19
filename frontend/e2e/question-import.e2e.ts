import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  Workbook,
} from "exceljs";

import path from "node:path";


const ADMIN_EMAIL =
  process.env
    .E2E_ADMIN_EMAIL ??
  "jhep159-demo-admin@example.test";

const ADMIN_PASSWORD =
  process.env
    .E2E_ADMIN_PASSWORD ??
  "DemoAdm1n!";

const CONTRIBUTOR_EMAIL =
  process.env
    .E2E_CONTRIBUTOR_EMAIL ??
  "jhep29-demo-learner@example.test";

const CONTRIBUTOR_PASSWORD =
  process.env
    .E2E_CONTRIBUTOR_PASSWORD ??
  "DemoL3arner!";

const CERTIFICATION_CODE =
  "JHEP29-DEMO-SECPLUS";

const CATEGORY_NAME =
  "Core concepts";

const IMPORT_HEADERS = [
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


type LoginResponse = {
  access_token: string;
};

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

type FixtureResult = {
  workbookPath: string;
  workbookName: string;
  runId: string;
  questions: string[];
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
  const login =
    await request.post(
      "/api/v1/auth/login",
      {
        data: {
          email:
            ADMIN_EMAIL,
          password:
            ADMIN_PASSWORD,
        },
      },
    );

  const admin =
    await responseJson<LoginResponse>(
      login,
      "Administrator login",
    );

  const authorization =
    {
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
            CONTRIBUTOR_EMAIL,
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
        CONTRIBUTOR_EMAIL,
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
      CONTRIBUTOR_EMAIL,
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
      CONTRIBUTOR_PASSWORD,
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
    `JHEP118-E2E-` +
    `${Date.now()}-` +
    `${testInfo.workerIndex}`
  );
}


async function createValidWorkbook(
  testInfo: TestInfo,
): Promise<FixtureResult> {
  const runId =
    runIdFor(
      testInfo,
    );

  const workbookName =
    `jhep-118-e2e-${runId}.xlsx`;

  const workbookPath =
    testInfo.outputPath(
      workbookName,
    );

  const questions = [
    `${runId} — Which practice best limits the damage of a compromised account?`,
    `${runId} — Based on the network diagram, which controls reduce lateral movement?`,
    `${runId} — What authentication approach is illustrated in the diagram?`,
  ];

  const workbook =
    new Workbook();

  const sheet =
    workbook.addWorksheet(
      "Questions",
    );

  sheet.addRow(
    [...IMPORT_HEADERS],
  );

  sheet.addRow([
    "2.0",
    CERTIFICATION_CODE,
    CATEGORY_NAME,
    "easy",
    "multiple_choice",
    false,
    questions[0],
    "Grant only the access required for the user's job",
    "Give every user administrator access",
    "Reuse one shared password",
    "Disable sign-in logging",
    null,
    null,
    "A",
    null,
    "Least privilege reduces the impact of an account compromise.",
    null,
    null,
  ]);

  sheet.addRow([
    "2.0",
    CERTIFICATION_CODE,
    CATEGORY_NAME,
    "medium",
    "multiple_choice",
    true,
    questions[1],
    "Separate user and server network segments",
    "Filter traffic between segments with a firewall",
    "Use one shared administrator password",
    "Disable centralized logging",
    null,
    null,
    "A;B",
    null,
    "Segmentation and filtering reduce paths available for lateral movement.",
    "segmented-network.png",
    "User and server networks separated by a firewall.",
  ]);

  sheet.addRow([
    "2.0",
    CERTIFICATION_CODE,
    CATEGORY_NAME,
    "easy",
    "short_answer",
    false,
    questions[2],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "Multifactor authentication",
    "The diagram shows a password followed by a separate authenticator code.",
    "mfa-login-flow.png",
    "Password followed by an authenticator code before access.",
  ]);

  await workbook.xlsx.writeFile(
    workbookPath,
  );

  return {
    workbookPath,
    workbookName,
    runId,
    questions,
  };
}


async function createInvalidWorkbook(
  testInfo: TestInfo,
): Promise<FixtureResult> {
  const runId =
    runIdFor(
      testInfo,
    );

  const workbookName =
    `jhep-118-invalid-${runId}.xlsx`;

  const workbookPath =
    testInfo.outputPath(
      workbookName,
    );

  const questions = [
    `${runId} — valid row that must never partially persist`,
    `${runId} — invalid certification row`,
  ];

  const workbook =
    new Workbook();

  const sheet =
    workbook.addWorksheet(
      "Questions",
    );

  sheet.addRow(
    [...IMPORT_HEADERS],
  );

  sheet.addRow([
    "2.0",
    CERTIFICATION_CODE,
    CATEGORY_NAME,
    "easy",
    "multiple_choice",
    false,
    questions[0],
    "Correct",
    "Incorrect",
    null,
    null,
    null,
    null,
    "A",
    null,
    "This row is valid but must not be partially imported.",
    null,
    null,
  ]);

  sheet.addRow([
    "2.0",
    "CERTIFICATION-DOES-NOT-EXIST",
    CATEGORY_NAME,
    "easy",
    "multiple_choice",
    false,
    questions[1],
    "Correct",
    "Incorrect",
    null,
    null,
    null,
    null,
    "A",
    null,
    "This row deliberately has an unknown certification.",
    null,
    null,
  ]);

  await workbook.xlsx.writeFile(
    workbookPath,
  );

  return {
    workbookPath,
    workbookName,
    runId,
    questions,
  };
}


function fixturePath(
  filename: string,
) {
  return path.resolve(
    process.cwd(),
    "e2e",
    "fixtures",
    filename,
  );
}


test.describe.serial(
  "JHEP-118 bulk question import",
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
      "Contributor imports three questions with images and can reopen history",
      async ({
        page,
      }, testInfo) => {
        const fixture =
          await createValidWorkbook(
            testInfo,
          );

        await loginAsContributor(
          page,
        );

        await page
          .getByRole(
            "link",
            {
              name:
                "Import Questions",
            },
          )
          .click();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Import Questions",
            },
          ),
        ).toBeVisible();

        await page
          .getByLabel(
            "Question bank workbook",
          )
          .setInputFiles(
            fixture.workbookPath,
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
                "Add referenced images",
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByText(
            "segmented-network.png",
            {
              exact:
                true,
            },
          ).first(),
        ).toBeVisible();

        await expect(
          page.getByText(
            "mfa-login-flow.png",
            {
              exact:
                true,
            },
          ).first(),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Import blocked",
            },
          ),
        ).toBeVisible();

        await page
          .getByLabel(
            "Import images",
          )
          .setInputFiles([
            fixturePath(
              "segmented-network.png",
            ),
            fixturePath(
              "mfa-login-flow.png",
            ),
          ]);

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Ready to import",
            },
          ),
        ).toBeVisible({
          timeout:
            40_000,
        });

        await page
          .getByRole(
            "button",
            {
              name:
                "Import 3 Questions",
            },
          )
          .click();

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Import complete",
            },
          ),
        ).toBeVisible({
          timeout:
            30_000,
        });

        await page
          .getByRole(
            "link",
            {
              name:
                "View Question Bank",
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

        const importedRows =
          page
            .locator(
              "tbody tr",
            )
            .filter({
              hasText:
                fixture.runId,
            });

        await expect(
          importedRows,
        ).toHaveCount(
          3,
        );

        for (
          const questionText
          of fixture.questions
        ) {
          const row =
            page
              .locator(
                "tbody tr",
              )
              .filter({
                hasText:
                  questionText,
              });

          await expect(
            row,
          ).toHaveCount(
            1,
          );

          await expect(
            row.getByText(
              "Pending Review",
              {
                exact:
                  true,
              },
            ),
          ).toBeVisible();
        }

        await expect(
          page
            .locator(
              "tbody tr",
            )
            .filter({
              hasText:
                fixture.questions[1],
            })
            .getByText(
              "Image",
              {
                exact:
                  true,
              },
            ),
        ).toBeVisible();

        await expect(
          page
            .locator(
              "tbody tr",
            )
            .filter({
              hasText:
                fixture.questions[2],
            })
            .getByText(
              "Image",
              {
                exact:
                  true,
              },
            ),
        ).toBeVisible();

        const firstRow =
          page
            .locator(
              "tbody tr",
            )
            .filter({
              hasText:
                fixture.questions[0],
            });

        await firstRow
          .getByRole(
            "link",
            {
              name:
                /^View Q-/,
            },
          )
          .click();

        await expect(
          page,
        ).toHaveURL(
          /\/admin\/questions\/[^/]+$/,
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                /Question Details/,
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByText(
            "PENDING REVIEW — awaiting Administrator review.",
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
                "Approve & Publish",
            },
          ),
        ).toHaveCount(
          0,
        );

        await expect(
          page.getByRole(
            "button",
            {
              name:
                "Reject",
            },
          ),
        ).toHaveCount(
          0,
        );

        await page.goto(
          "/admin/questions/import",
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Recent Imports",
            },
          ),
        ).toBeVisible();

        const filename =
          page.getByText(
            fixture.workbookName,
            {
              exact:
                true,
            },
          );

        await expect(
          filename,
        ).toBeVisible();

        const historyItem =
          filename.locator(
            "xpath=ancestor::div[.//button[normalize-space()='View']][1]",
          );

        await historyItem
          .getByRole(
            "button",
            {
              name:
                "View",
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
                "Already imported",
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "button",
            {
              name:
                /Import \d+ Questions/,
            },
          ),
        ).toHaveCount(
          0,
        );
      },
    );


    test(
      "blocking validation prevents partial question creation",
      async ({
        page,
      }, testInfo) => {
        const fixture =
          await createInvalidWorkbook(
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
            fixture.workbookPath,
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
          page.getByText(
            "CERTIFICATION_NOT_FOUND",
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
                /Import \d+ Questions/,
            },
          ),
        ).toHaveCount(
          0,
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
