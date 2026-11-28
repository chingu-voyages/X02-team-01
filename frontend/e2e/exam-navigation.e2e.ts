import { spawnSync } from "node:child_process";
import path from "node:path";
import { mobileNavigation } from "./helpers/exam-navigation";
import { expect, test, type Page } from "@playwright/test";
import type { ExamAttempt, ExamCreatedResponse, QuestionFeedback } from "../src/types/exam-api.types";

type FeedbackMode = "immediate" | "deferred";

type NavigationFixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  question_count: number;
};

function createFixture(mode: FeedbackMode): NavigationFixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const result = spawnSync(
    path.join(backend, ".venv/bin/python"),
    ["-m", "scripts.seed_navigation_e2e", "--confirm-local", "--mode", mode],
    { cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to seed JHEP-105 ${mode} fixtures. ${result.error?.message ?? result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as NavigationFixture;
}

async function startAttempt(page: Page, mode: FeedbackMode) {
  const fixture = createFixture(mode);

  // Use the actual login screen and a fresh learner, not the shared demo
  // learner which the existing contributor E2E tests may promote.
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);

  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Login did not establish a learner session");
  const headers = { Authorization: `Bearer ${token}` };

  // Start through the real JHEP-126 published-exam API. Catalog UI is not
  // under test here; the actual exam screen, submissions, and DB are.
  const response = await page.request.post("/api/v1/exams", {
    headers,
    data: {
      certification_id: fixture.certification_id,
      category_id: fixture.category_id,
      practice_exam_id: fixture.practice_exam_id,
      question_count: fixture.question_count,
    },
  });
  expect(response.status(), "published exam creation").toBe(201);
  const attempt = (await response.json()) as ExamCreatedResponse;
  expect(attempt.questions).toHaveLength(fixture.question_count);

  const writes: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/v1\/exams(?:\/|$)/.test(pathname) &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto(`/exams/${attempt.attempt_id}`);
  await expectQuestion(page, attempt, 1);

  async function readAttempt(): Promise<ExamAttempt> {
    const response = await page.request.get(`/api/v1/exams/${attempt.attempt_id}`, { headers });
    expect(response.ok(), "read persisted attempt").toBe(true);
    return (await response.json()) as ExamAttempt;
  }

  return { attempt, writes, readAttempt };
}

async function expectQuestion(page: Page, attempt: ExamCreatedResponse, number: number) {
  await expect(page.locator("#question-heading")).toHaveText(
    attempt.questions[number - 1].question_text,
  );
  await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}$`));
}

function questionButton(page: Page, number: number) {
  return page.getByRole("navigation", { name: "Question navigation", exact: true })
    .getByRole("button", { name: `Question ${number}`, exact: true });
}

function firstOption(page: Page) {
  return page.getByRole("radio").first();
}

async function submitCurrentAnswer(page: Page, attempt: ExamCreatedResponse, number: number) {
  const path = `/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[number - 1].id}/submit`;
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === path && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Submit answer", exact: true }).click(),
  ]);
  expect(response.ok(), "submit question response").toBe(true);
  await expect(firstOption(page)).toBeDisabled();
  return (await response.json()) as QuestionFeedback;
}

test.describe("JHEP-105 numbered exam navigation", () => {
  // A recovered hydration error must fail the test, even when the
  // learner workflow still works after React regenerates the subtree.
  const hydrationErrors = new WeakMap<Page, string[]>();
  const hydrationPattern = /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i;

  test.beforeEach(({ page }) => {
    const errors: string[] = [];
    hydrationErrors.set(page, errors);
    const record = (message: string) => {
      if (hydrationPattern.test(message)) errors.push(message);
    };
    page.on("pageerror", (error) => record(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") record(message.text());
    });
  });

  test.afterEach(({ page }) => {
    expect(hydrationErrors.get(page) ?? [], "React hydration errors").toEqual([]);
  });

  test("desktop: direct jumps retain drafts, lock answers, and preserve immediate feedback through results", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { attempt, writes, readAttempt } = await startAttempt(page, "immediate");
    const nav = page.getByRole("navigation", { name: "Question navigation", exact: true });

    await expect(nav.getByRole("button")).toHaveCount(3);
    await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: /^Question Navigation/ })).toBeHidden();

    await firstOption(page).click();
    await expect(firstOption(page)).toBeChecked();

    // Use keyboard to jump out of order without submitting the draft.
    await questionButton(page, 3).focus();
    await page.keyboard.press("Enter");
    await expectQuestion(page, attempt, 3);
    await expect(questionButton(page, 3)).toHaveAttribute("aria-current", "step");
    await expect(questionButton(page, 1)).not.toHaveAttribute("aria-current", "step");
    await expect(firstOption(page)).not.toBeChecked();
    await questionButton(page, 1).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    expect(writes).toEqual([]);
    const before = await readAttempt();
    expect(before.status).toBe("in_progress");
    expect(before.questions.every((question) => !question.response)).toBe(true);

    const immediate = await submitCurrentAnswer(page, attempt, 1);
    expect(immediate.feedback_released).toBe(true);
    expect(immediate.is_correct).toBe(true);
    await expect(page.getByText("Correct answer.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Fixture explanation \d+: option A is correct\./)).toBeVisible();

    await page.getByRole("button", { name: "Next question" }).click();
    await expectQuestion(page, attempt, 2);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    await expect(firstOption(page)).toBeDisabled();
    await expect(page.getByText("Correct answer.", { exact: true })).toBeVisible();

    // Submit in a nonsequential order, then return to the last question
    // to finish, using the existing finish-exam behavior.
    await questionButton(page, 3).click();
    await expectQuestion(page, attempt, 3);
    await firstOption(page).click();
    await submitCurrentAnswer(page, attempt, 3);
    await expect(page.getByRole("button", { name: "Finish Exam" })).toHaveCount(0);
    await questionButton(page, 2).click();
    await expectQuestion(page, attempt, 2);
    await firstOption(page).click();
    await submitCurrentAnswer(page, attempt, 2);
    await questionButton(page, 3).click();
    await expectQuestion(page, attempt, 3);
    const saved = await readAttempt();
    expect(saved.questions.every((question) => question.response?.is_submitted)).toBe(true);
    expect(writes).toHaveLength(3);

    await page.getByRole("button", { name: "Finish Exam", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
    await expect(page.getByRole("heading", { name: "Practice exam complete" })).toBeVisible();
    expect(writes).toHaveLength(4);
  });

  test("mobile: paginated navigation supports keyboard and deferred feedback without losing answers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, writes, readAttempt } = await startAttempt(page, "deferred");
    const nav = mobileNavigation(page);
    await expect(nav.trigger).toBeVisible();
    await nav.expectClosed();
    await expect(page.getByRole("navigation", { name: "Question navigation", exact: true })).toHaveCount(0);
    await firstOption(page).click();
    await expect(firstOption(page)).toBeChecked();

    // The current control is an inline disclosure, not a modal. Keyboard
    // activation keeps focus on the trigger; Tab enters the first tile.
    await nav.trigger.press("Enter");
    await nav.expectOpen();
    await nav.expectSet(1, 15);
    await expect(nav.trigger).toBeFocused();
    await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
    await page.keyboard.press("Tab");
    await expect(questionButton(page, 1)).toBeFocused();

    // Paging browses the full question set without navigating or saving.
    await nav.goToLastSet();
    await expect(questionButton(page, 40)).toBeVisible();
    await expect(questionButton(page, 40)).not.toHaveAttribute("aria-current");
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    expect(writes).toEqual([]);

    await questionButton(page, 40).press("Escape");
    await nav.expectClosed();
    await expect(nav.trigger).toBeFocused();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();

    // Reopening follows the active question, rather than a stale browsing page.
    await nav.open();
    await nav.expectSet(1, 15);
    await nav.goToLastSet();
    await questionButton(page, 40).click();
    await nav.expectClosed();
    await expectQuestion(page, attempt, 40);
    await nav.expectQuestionFocus(40);
    await expect(firstOption(page)).not.toBeChecked();

    await nav.open();
    await nav.expectSet(31, 40);
    await expect(questionButton(page, 40)).toHaveAttribute("aria-current", "step");
    await nav.close();
    await expect(nav.trigger).toBeFocused();
    await expectQuestion(page, attempt, 40);

    await nav.open();
    await nav.goToFirstSet();
    await questionButton(page, 1).click();
    await nav.expectClosed();
    await expectQuestion(page, attempt, 1);
    await nav.expectQuestionFocus(1);
    await expect(firstOption(page)).toBeChecked();
    expect(writes).toEqual([]);

    const deferred = await submitCurrentAnswer(page, attempt, 1);
    expect(deferred.feedback_released).toBe(false);
    expect(deferred.is_correct ?? null).toBeNull();
    expect(deferred.correct_option_ids ?? null).toBeNull();
    expect(deferred.explanation ?? null).toBeNull();
    await expect(page.getByText("Answer submitted.", { exact: true })).toBeVisible();

    await nav.open();
    await nav.goToLastSet();
    await questionButton(page, 40).click();
    await expectQuestion(page, attempt, 40);
    await nav.open();
    await nav.goToFirstSet();
    await questionButton(page, 1).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeDisabled();
    await expect(firstOption(page)).toBeChecked();
    await expect(page.getByText("Correct answer.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Incorrect answer.", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Fixture explanation \d+/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finish Exam" })).toHaveCount(0);

    const saved = await readAttempt();
    expect(saved.status).toBe("in_progress");
    expect(saved.questions[0].response?.is_submitted).toBe(true);
    expect(saved.questions.slice(1).every((question) => !question.response)).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
