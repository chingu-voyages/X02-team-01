import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  ExamAttempt,
  ExamCreatedResponse,
  QuestionFlagSaved,
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

function createFixture(mode: FeedbackMode): NavigationFixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const result = spawnSync(
    path.join(backend, ".venv/bin/python"),
    ["-m", "scripts.seed_navigation_e2e", "--confirm-local", "--mode", mode],
    { cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to seed JHEP-104 ${mode} fixtures. ${result.error?.message ?? result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as NavigationFixture;
}

async function startAttempt(page: Page, mode: FeedbackMode) {
  const fixture = createFixture(mode);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);

  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Login did not establish a learner session");
  const headers = { Authorization: `Bearer ${token}` };
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
  expect(attempt.questions.every((q) => q.flagged_for_review === false)).toBe(true);

  const writes: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith(`/api/v1/exams/${attempt.attempt_id}`) &&
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

function questionButton(page: Page, number: number, flagged = false) {
  return page.getByRole("navigation", { name: "Question navigation", exact: true })
    .getByRole("button", {
      name: `Question ${number}${flagged ? ", flagged for review" : ""}`,
      exact: true,
    });
}

function firstOption(page: Page) {
  return page.getByRole("radio").first();
}

function flagPath(attempt: ExamCreatedResponse, number: number) {
  return `/api/v1/exams/${attempt.attempt_id}/questions/${attempt.questions[number - 1].id}/flag`;
}

async function setFlag(
  page: Page,
  attempt: ExamCreatedResponse,
  number: number,
  flagged: boolean,
  keyboard = false,
) {
  const button = page.getByRole("button", {
    name: flagged ? "Flag for Review" : "Remove Flag",
    exact: true,
  });
  await expect(button).toBeEnabled();
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === flagPath(attempt, number) &&
    response.request().method() === "PUT",
  );
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Enter");
  } else {
    await button.click();
  }
  const response = await responsePromise;
  expect(response.status(), "flag write").toBe(200);
  expect(response.request().postDataJSON()).toEqual({ flagged_for_review: flagged });
  const saved = (await response.json()) as QuestionFlagSaved;
  expect(saved).toEqual({
    attempt_id: attempt.attempt_id,
    question_version_id: attempt.questions[number - 1].id,
    flagged_for_review: flagged,
  });
  await expect(page.getByRole("button", {
    name: flagged ? "Remove Flag" : "Flag for Review", exact: true,
  })).toBeEnabled();
}

async function submitCurrentAnswer(page: Page, attempt: ExamCreatedResponse, number: number) {
  const endpoint = `/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[number - 1].id}/submit`;
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === endpoint &&
      response.request().method() === "POST"),
    page.getByRole("button", { name: "Submit answer", exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(firstOption(page)).toBeDisabled();
  return (await response.json()) as QuestionFeedback;
}

function expectNoFeedback(page: Page) {
  return Promise.all([
    expect(page.getByText("Correct answer.", { exact: true })).toHaveCount(0),
    expect(page.getByText("Incorrect answer.", { exact: true })).toHaveCount(0),
    expect(page.getByText(/Fixture explanation \d+/)).toHaveCount(0),
  ]);
}

test.describe("JHEP-104 flag and unflag questions", () => {
  const hydrationErrors = new WeakMap<Page, string[]>();
  const hydrationPattern = /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i;

  test.beforeEach(({ page }) => {
    const errors: string[] = [];
    hydrationErrors.set(page, errors);
    page.on("pageerror", (error) => {
      if (hydrationPattern.test(error.message)) errors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error" && hydrationPattern.test(message.text())) errors.push(message.text());
    });
  });

  test.afterEach(({ page }) => {
    expect(hydrationErrors.get(page) ?? [], "React hydration errors").toEqual([]);
  });

  test("desktop: flag unanswered, draft and submitted questions without affecting scoring", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { attempt, writes, readAttempt } = await startAttempt(page, "immediate");
    expect(attempt.questions).toHaveLength(3);
    await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
    await setFlag(page, attempt, 1, true, true);
    await expect(questionButton(page, 1, true)).toHaveAttribute("aria-current", "step");
    const unanswered = await readAttempt();
    expect(unanswered.questions[0].flagged_for_review).toBe(true);
    expect(unanswered.questions[0].response ?? null).toBeNull();
    expect(unanswered.questions.slice(1).every((q) => q.flagged_for_review === false)).toBe(true);
    expect(writes).toEqual([`PUT ${flagPath(attempt, 1)}`]);

    await firstOption(page).click();
    await expect(firstOption(page)).toBeChecked();
    await setFlag(page, attempt, 1, false);
    await expect(firstOption(page)).toBeChecked();
    await setFlag(page, attempt, 1, true);
    await questionButton(page, 3).click();
    await expectQuestion(page, attempt, 3);
    await expect(questionButton(page, 1, true)).not.toHaveAttribute("aria-current", "step");
    await questionButton(page, 1, true).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    const draft = await readAttempt();
    expect(draft.questions[0].response ?? null).toBeNull();
    expect(draft.questions[0].flagged_for_review).toBe(true);
    expect(writes).toEqual(Array(3).fill(`PUT ${flagPath(attempt, 1)}`));

    const feedback = await submitCurrentAnswer(page, attempt, 1);
    expect(feedback.feedback_released).toBe(true);
    expect(feedback.is_correct).toBe(true);
    await setFlag(page, attempt, 1, false);
    await setFlag(page, attempt, 1, true);
    await expect(firstOption(page)).toBeDisabled();
    await expect(firstOption(page)).toBeChecked();
    await expect(page.getByText("Correct answer.", { exact: true })).toBeVisible();
    const saved = await readAttempt();
    expect(saved.questions[0].response?.is_submitted).toBe(true);
    expect(saved.questions[0].response?.selected_option_ids).toEqual([attempt.questions[0].options[0].id]);
    expect(saved.questions[0].flagged_for_review).toBe(true);

    for (const number of [2, 3]) {
      await questionButton(page, number).click();
      await expectQuestion(page, attempt, number);
      await firstOption(page).click();
      const result = await submitCurrentAnswer(page, attempt, number);
      expect(result.is_correct).toBe(true);
    }
    await setFlag(page, attempt, 3, true);
    await expect(page.getByRole("button", { name: "Finish Exam", exact: true })).toBeEnabled();
    const [finished] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname ===
        `/api/v1/exams/${attempt.attempt_id}/submit` && response.request().method() === "POST"),
      page.getByRole("button", { name: "Finish Exam", exact: true }).click(),
    ]);
    expect(finished.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
    await expect(page.getByRole("heading", { name: "Practice exam complete" })).toBeVisible();
    const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
    const results = await page.request.get(`/api/v1/exams/${attempt.attempt_id}/results`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(results.ok()).toBe(true);
    expect(await results.json()).toMatchObject({
      status: "submitted", correct_count: 3, incorrect_count: 0, score_percent: 100,
    });
  });

  test("mobile: flags survive popup navigation, failed saves and deferred submission", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, writes, readAttempt } = await startAttempt(page, "deferred");
    expect(attempt.questions).toHaveLength(40);
    const trigger = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: "Question Navigation" });
    const dialog = page.getByRole("dialog", { name: "Question Navigation", exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("button", { name: "Flag for Review", exact: true })).toBeVisible();
    await firstOption(page).click();
    await setFlag(page, attempt, 1, true);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(questionButton(page, 1, true)).toHaveAttribute("aria-current", "step");
    await questionButton(page, 40).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expectQuestion(page, attempt, 40);
    await setFlag(page, attempt, 40, true);
    await trigger.click();
    await expect(questionButton(page, 40, true)).toHaveAttribute("aria-current", "step");
    await questionButton(page, 1, true).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    expect(writes).toEqual([`PUT ${flagPath(attempt, 1)}`, `PUT ${flagPath(attempt, 40)}`]);

    // Fail just one write before it reaches the server. The next retry is real.
    const endpoint = `**${flagPath(attempt, 1)}`;
    await page.route(endpoint, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Unable to save review flag" }) });
    }, { times: 1 });
    await page.getByRole("button", { name: "Remove Flag", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Unable to save review flag",
      }),
    ).toHaveText("Unable to save review flag");
    await expect(page.getByRole("button", { name: "Remove Flag", exact: true })).toBeEnabled();
    expect((await readAttempt()).questions[0].flagged_for_review).toBe(true);
    await setFlag(page, attempt, 1, false);
    await expect(
        page.getByRole("alert").filter({
          hasText: "Unable to save review flag",
        }),
      ).toHaveCount(0);
    await expect(firstOption(page)).toBeChecked();
    await trigger.click();
    await expect(questionButton(page, 1)).toHaveAttribute("aria-current", "step");
    await expect(questionButton(page, 40, true)).not.toHaveAttribute("aria-current", "step");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    const deferred = await submitCurrentAnswer(page, attempt, 1);
    expect(deferred.feedback_released).toBe(false);
    expect(deferred.is_correct ?? null).toBeNull();
    expect(deferred.correct_option_ids ?? null).toBeNull();
    expect(deferred.explanation ?? null).toBeNull();
    await setFlag(page, attempt, 1, true);
    await expect(firstOption(page)).toBeDisabled();
    await expect(firstOption(page)).toBeChecked();
    await expectNoFeedback(page);
    await trigger.click();
    await expect(questionButton(page, 1, true)).toHaveAttribute("aria-current", "step");
    await expect(questionButton(page, 40, true)).toBeEnabled();
    await questionButton(page, 40, true).click();
    await expectQuestion(page, attempt, 40);
    await trigger.click();
    await questionButton(page, 1, true).click();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeDisabled();
    await expectNoFeedback(page);
    const saved = await readAttempt();
    expect(saved.status).toBe("in_progress");
    expect(saved.questions[0].response?.is_submitted).toBe(true);
    expect(saved.questions[0].response?.is_correct).toBeUndefined();
    expect(saved.questions.filter((q) => q.flagged_for_review).map((q) => q.id)).toEqual([
      attempt.questions[0].id, attempt.questions[39].id,
    ]);
    expect(saved.questions.slice(1).every((q) => !q.response)).toBe(true);
  });
});
