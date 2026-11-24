import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  expect,
  test,
  type Page,
} from "@playwright/test";

import type {
  ExamAttempt,
  ExamCreatedResponse,
  QuestionFeedback,
} from "../src/types/exam-api.types";

type FeedbackMode = "immediate" | "deferred";

type NavigationFixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  question_count: number;
};

function createFixture(
  mode: FeedbackMode,
): NavigationFixture {
  const backend = path.resolve(
    process.cwd(),
    "../backend",
  );

  const result = spawnSync(
    path.join(backend, ".venv/bin/python"),
    [
      "-m",
      "scripts.seed_navigation_e2e",
      "--confirm-local",
      "--mode",
      mode,
    ],
    {
      cwd: backend,
      env: process.env,
      encoding: "utf8",
      timeout: 60_000,
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to seed JHEP-106 ${mode} fixtures. ${
        result.error?.message ?? result.stderr
      }`,
    );
  }

  return JSON.parse(
    result.stdout,
  ) as NavigationFixture;
}

async function startAttempt(
  page: Page,
  mode: FeedbackMode,
) {
  const fixture = createFixture(mode);

  await page.goto("/login");

  await page
    .getByLabel("Email address")
    .fill(fixture.email);

  await page
    .getByLabel("Password", { exact: true })
    .fill(fixture.password);

  await page
    .getByRole("button", {
      name: "Sign in",
      exact: true,
    })
    .click();

  await expect(page).toHaveURL(/\/categories\/?$/);

  const token = await page.evaluate(() =>
    sessionStorage.getItem("jhep_auth_token"),
  );

  if (!token) {
    throw new Error(
      "Login did not establish a learner session",
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const response = await page.request.post(
    "/api/v1/exams",
    {
      headers,
      data: {
        certification_id: fixture.certification_id,
        category_id: fixture.category_id,
        practice_exam_id: fixture.practice_exam_id,
        question_count: fixture.question_count,
      },
    },
  );

  expect(response.status()).toBe(201);

  const attempt =
    (await response.json()) as ExamCreatedResponse;

  expect(attempt.questions).toHaveLength(
    fixture.question_count,
  );

  await page.goto(`/exams/${attempt.attempt_id}`);

  await expectQuestion(page, attempt, 1);

  async function readAttempt(): Promise<ExamAttempt> {
    const response = await page.request.get(
      `/api/v1/exams/${attempt.attempt_id}`,
      { headers },
    );

    expect(response.ok()).toBe(true);

    return (await response.json()) as ExamAttempt;
  }

  return { attempt, readAttempt, headers };
}

async function expectQuestion(
  page: Page,
  attempt: ExamCreatedResponse,
  number: number,
) {
  await expect(
    page.locator("#question-heading"),
  ).toHaveText(
    attempt.questions[number - 1].question_text,
  );

  await expect(page).toHaveURL(
    new RegExp(`/exams/${attempt.attempt_id}$`),
  );
}

function navigator(page: Page) {
  return page.getByRole("navigation", {
    name: "Question navigation",
    exact: true,
  });
}

function questionButton(
  page: Page,
  number: number,
  flagged = false,
) {
  return navigator(page).getByRole("button", {
    name: `Question ${number}${
      flagged ? ", flagged for review" : ""
    }`,
    exact: true,
  });
}

function firstOption(page: Page) {
  return page.getByRole("radio").first();
}

function submitButton(page: Page) {
  return page.getByRole("button", {
    name: "Submit answer",
    exact: true,
  });
}

function submitPath(
  attempt: ExamCreatedResponse,
  number: number,
) {
  return `/api/v1/exams/${attempt.attempt_id}/responses/${
    attempt.questions[number - 1].id
  }/submit`;
}

async function expectProgress(
  page: Page,
  submitted: number,
  total: number,
) {
  const progress = navigator(page).getByRole(
    "progressbar",
    {
      name: "Exam submission progress",
    },
  );

  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    `${submitted} of ${total} questions submitted`,
  );

  await expect(progress).toHaveAttribute(
    "aria-valuenow",
    String(
      total > 0
        ? Math.round((submitted / total) * 100)
        : 0,
    ),
  );
}

async function expectLegend(page: Page) {
  const legend = navigator(page).getByRole("region", {
    name: "Question state legend",
  });

  for (const label of [
    "Unanswered",
    "Selected but unsubmitted",
    "Submitted",
    "Flagged for review",
    "Current question",
  ]) {
    await expect(
      legend.getByText(label, { exact: true }),
    ).toBeVisible();
  }
}

async function setFlag(
  page: Page,
  flagged: boolean,
) {
  await page
    .getByRole("button", {
      name: flagged
        ? "Flag for Review"
        : "Remove Flag",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("button", {
      name: flagged
        ? "Remove Flag"
        : "Flag for Review",
      exact: true,
    }),
  ).toBeEnabled();
}

async function submitCurrentAnswer(
  page: Page,
  attempt: ExamCreatedResponse,
  number: number,
) {
  const endpoint = submitPath(attempt, number);

  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          endpoint &&
        response.request().method() === "POST",
    ),
    submitButton(page).click(),
  ]);

  expect(response.ok()).toBe(true);

  await expect(firstOption(page)).toBeDisabled();

  return (await response.json()) as QuestionFeedback;
}

async function expectNoFeedback(page: Page) {
  await expect(
    page.getByText("Correct answer.", {
      exact: true,
    }),
  ).toHaveCount(0);

  await expect(
    page.getByText("Incorrect answer.", {
      exact: true,
    }),
  ).toHaveCount(0);

  await expect(
    page.getByText(/Fixture explanation \d+/),
  ).toHaveCount(0);
}

test.describe("JHEP-106 question state indicators", () => {
  const hydrationErrors = new WeakMap<
    Page,
    string[]
  >();

  const hydrationPattern =
    /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i;

  test.beforeEach(({ page }) => {
    const errors: string[] = [];

    hydrationErrors.set(page, errors);

    page.on("pageerror", (error) => {
      if (hydrationPattern.test(error.message)) {
        errors.push(error.message);
      }
    });

    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        hydrationPattern.test(message.text())
      ) {
        errors.push(message.text());
      }
    });
  });

  test.afterEach(({ page }) => {
    expect(
      hydrationErrors.get(page) ?? [],
      "React hydration errors",
    ).toEqual([]);
  });

  test("desktop: response states, flags and progress remain independent through completion", async ({
    page,
  }) => {
    await page.setViewportSize({
      width: 1440,
      height: 900,
    });

    const { attempt, readAttempt, headers } =
      await startAttempt(page, "immediate");

    await expect(
      navigator(page).getByRole("button"),
    ).toHaveCount(3);

    await expect(
      questionButton(page, 1),
    ).toHaveAccessibleDescription("Unanswered");

    await expect(
      questionButton(page, 1),
    ).toHaveAttribute("aria-current", "step");

    await expectProgress(page, 0, 3);
    await expectLegend(page);

    // Flag an unanswered question.

    await setFlag(page, true);

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription("Unanswered");

    await expectProgress(page, 0, 3);

    // Select an incorrect answer deliberately.
    // Submitted status must not indicate correctness.

    const incorrectOption = page
      .getByRole("radio")
      .nth(1);

    await incorrectOption.click();

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    await expectProgress(page, 0, 3);

    // Navigate away using the keyboard.

    await questionButton(page, 3).focus();
    await page.keyboard.press("Enter");

    await expectQuestion(page, attempt, 3);

    await expect(
      questionButton(page, 3),
    ).toHaveAttribute("aria-current", "step");

    await expect(
      questionButton(page, 1, true),
    ).not.toHaveAttribute("aria-current");

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    await questionButton(page, 1, true).click();

    await expectQuestion(page, attempt, 1);

    await expect(incorrectOption).toBeChecked();

    const draft = await readAttempt();

    expect(
      draft.questions[0].response ?? null,
    ).toBeNull();

    expect(
      draft.questions[0].flagged_for_review,
    ).toBe(true);

    // Submit and verify that incorrect answers
    // still count toward completed progress.

    const feedback = await submitCurrentAnswer(
      page,
      attempt,
      1,
    );

    expect(feedback.feedback_released).toBe(true);
    expect(feedback.is_correct).toBe(false);

    await expect(
      page.getByText("Incorrect answer.", {
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription("Submitted");

    await expectProgress(page, 1, 3);

    // Removing a flag must not change submission.

    await setFlag(page, false);

    await expect(
      questionButton(page, 1),
    ).toHaveAccessibleDescription("Submitted");

    await expectProgress(page, 1, 3);

    // Complete the remaining questions.

    for (const number of [2, 3]) {
      await questionButton(page, number).click();

      await expectQuestion(page, attempt, number);

      await firstOption(page).click();

      await expect(
        questionButton(page, number),
      ).toHaveAccessibleDescription(
        "Selected but unsubmitted",
      );

      await expectProgress(page, number - 1, 3);

      await submitCurrentAnswer(
        page,
        attempt,
        number,
      );

      await expect(
        questionButton(page, number),
      ).toHaveAccessibleDescription("Submitted");

      await expectProgress(page, number, 3);
    }

    // A flag on a submitted question does not
    // affect progress or prevent completion.

    await setFlag(page, true);

    await expect(
      questionButton(page, 3, true),
    ).toHaveAccessibleDescription("Submitted");

    await expectProgress(page, 3, 3);

    const saved = await readAttempt();

    expect(
      saved.questions.every(
        (question) =>
          question.response?.is_submitted,
      ),
    ).toBe(true);

    await page
      .getByRole("button", {
        name: "Finish Exam",
        exact: true,
      })
      .click();

    await expect(page).toHaveURL(
      new RegExp(
        `/exams/${attempt.attempt_id}/results$`,
      ),
    );

    await expect(
      page.getByRole("heading", {
        name: "Practice exam complete",
      }),
    ).toBeVisible();

    const results = await page.request.get(
      `/api/v1/exams/${attempt.attempt_id}/results`,
      { headers },
    );

    expect(results.ok()).toBe(true);

    expect(await results.json()).toMatchObject({
      status: "submitted",
      correct_count: 2,
      incorrect_count: 1,
    });
  });

  test("mobile: states, progress, scrolling and deferred feedback remain accurate", async ({
    page,
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844,
    });

    const { attempt, readAttempt } =
      await startAttempt(page, "deferred");

    expect(attempt.questions).toHaveLength(40);

    const trigger = page
      .locator('button[aria-haspopup="dialog"]')
      .filter({ hasText: "Question Navigation" });

    const dialog = page.getByRole("dialog", {
      name: "Question Navigation",
      exact: true,
    });

    const close = dialog.getByRole("button", {
      name: "Close question navigation",
    });

    await expect(trigger).toBeVisible();

    // Select and flag without submitting.

    await firstOption(page).click();
    await setFlag(page, true);

    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await expect(
      navigator(page).getByRole("button"),
    ).toHaveCount(40);

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    await expect(
      questionButton(page, 1, true),
    ).toHaveAttribute("aria-current", "step");

    await expect(
      questionButton(page, 40),
    ).toHaveAccessibleDescription("Unanswered");

    await expectProgress(page, 0, 40);
    await expectLegend(page);

    // Verify keyboard navigation.

    await page.keyboard.press("Tab");

    await expect(
      questionButton(page, 1, true),
    ).toBeFocused();

    // Verify real scrolling in a long exam.

    const scroller = navigator(page)
      .locator("ol")
      .locator("..");

    const scrollTop = await scroller.evaluate(
      (element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      },
    );

    expect(scrollTop).toBeGreaterThan(0);

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();

    await expect(dialog).toBeVisible();

    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollTop,
        ),
      )
      .toBe(scrollTop);

    // Jump to the final question.

    await questionButton(page, 40).click();

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await expectQuestion(page, attempt, 40);

    await setFlag(page, true);

    await trigger.click();

    await expect(
      questionButton(page, 40, true),
    ).toHaveAccessibleDescription("Unanswered");

    await expect(
      questionButton(page, 40, true),
    ).toHaveAttribute("aria-current", "step");

    await expectProgress(page, 0, 40);

    // Return to the original draft.

    await questionButton(page, 1, true).click();

    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();

    // Simulate a failed submission before it
    // reaches the backend. The retry is real.

    const endpoint = submitPath(attempt, 1);

    await page.route(
      `**${endpoint}`,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "Unable to submit answer",
          }),
        });
      },
      { times: 1 },
    );

    await submitButton(page).click();

    await expect(
      page.getByRole("alert").filter({
        hasText: "Unable to submit answer",
      }),
    ).toBeVisible();

    await expect(submitButton(page)).toBeEnabled();

    const failed = await readAttempt();

    expect(
      failed.questions[0].response ?? null,
    ).toBeNull();

    await trigger.click();

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription(
      "Selected but unsubmitted",
    );

    await expectProgress(page, 0, 40);

    await close.click();

    // Retry using the actual backend.

    const feedback = await submitCurrentAnswer(
      page,
      attempt,
      1,
    );

    expect(feedback.feedback_released).toBe(false);

    expect(
      feedback.is_correct ?? null,
    ).toBeNull();

    expect(
      feedback.correct_option_ids ?? null,
    ).toBeNull();

    expect(
      feedback.explanation ?? null,
    ).toBeNull();

    await expectNoFeedback(page);

    await trigger.click();

    await expect(
      questionButton(page, 1, true),
    ).toHaveAccessibleDescription("Submitted");

    await expect(
      questionButton(page, 40, true),
    ).toHaveAccessibleDescription("Unanswered");

    await expectProgress(page, 1, 40);

    await questionButton(page, 40, true).click();

    await expectQuestion(page, attempt, 40);

    await trigger.click();

    await questionButton(page, 1, true).click();

    await expectQuestion(page, attempt, 1);

    await expect(firstOption(page)).toBeDisabled();
    await expect(firstOption(page)).toBeChecked();

    await expectNoFeedback(page);

    const saved = await readAttempt();

    expect(saved.status).toBe("in_progress");

    expect(
      saved.questions[0].response?.is_submitted,
    ).toBe(true);

    expect(
      saved.questions[0].flagged_for_review,
    ).toBe(true);

    expect(
      saved.questions[39].flagged_for_review,
    ).toBe(true);

    expect(
      saved.questions.filter(
        (question) =>
          question.response?.is_submitted,
      ),
    ).toHaveLength(1);

    expect(
      saved.questions[0].response?.is_correct,
    ).toBeUndefined();
  });
});