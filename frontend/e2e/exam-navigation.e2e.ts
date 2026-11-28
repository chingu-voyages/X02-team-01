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

  return { attempt, writes, readAttempt, fixture };
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
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([]);
    await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
    const before = await readAttempt();
    expect(before.status).toBe("in_progress");
    expect(before.current_position).toBe(1);
    expect(before.questions[0].response).toMatchObject({
      is_submitted: false, selected_option_ids: [attempt.questions[0].options[0].id],
    });
    expect(before.questions.slice(1).every((question) => !question.response)).toBe(true);

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
    expect(writes.filter((write) => write.startsWith("POST "))).toHaveLength(3);

    await page.getByRole("button", { name: "Finish Exam", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
    await expect(page.getByRole("heading", { name: "Practice exam complete" })).toBeVisible();
    expect(writes.filter((write) => write.startsWith("POST "))).toHaveLength(4);
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

    // Paging browses the full question set without changing the saved position.
    // The draft selection itself may already have been autosaved.
    await nav.goToLastSet();
    await expect(questionButton(page, 40)).toBeVisible();
    await expect(questionButton(page, 40)).not.toHaveAttribute("aria-current");
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    expect(writes.filter((write) => write.startsWith("POST ") || write.startsWith("PATCH "))).toEqual([]);

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
    await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
    await page.reload();
    await expectQuestion(page, attempt, 40);
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
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([]);

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
    expect(writes.filter((write) => write.startsWith("POST "))).toHaveLength(1);
  });
  test("JHEP-89: saved draft and position survive refresh and a fresh authenticated browser context", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { attempt, fixture, readAttempt } = await startAttempt(page, "immediate");
    await firstOption(page).click();
    await submitCurrentAnswer(page, attempt, 1);
    await questionButton(page, 2).click();
    await expectQuestion(page, attempt, 2);
    await firstOption(page).click();
    await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
    const saved = await readAttempt();
    expect(saved.current_position).toBe(2);
    expect(saved.questions[0].response?.is_submitted).toBe(true);
    expect(saved.questions[1].response).toMatchObject({
      is_submitted: false, selected_option_ids: [attempt.questions[1].options[0].id],
    });
    await page.reload();
    await expectQuestion(page, attempt, 2);
    await expect(firstOption(page)).toBeChecked();
    await expect(firstOption(page)).toBeEnabled();
    await page.close();

    // A new context has no sessionStorage or cookies from the original page.
    // Re-authenticate as the same learner and discover the exact saved attempt.
    const context = await browser.newContext({ baseURL: "http://localhost:3030", viewport: { width: 390, height: 844 } });
    try {
      const returned = await context.newPage();
      await returned.goto("/login");
      await returned.getByLabel("Email address").fill(fixture.email);
      await returned.getByLabel("Password", { exact: true }).fill(fixture.password);
      await returned.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(returned).toHaveURL(/\/categories\/?$/);
      const creates: string[] = [];
      returned.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/exams") creates.push(request.url());
      });
      const recovered = returned.getByRole("region", { name: "Continue learning" });
      const continueButton = recovered.getByRole("button", { name: /^Continue exam/ });
      await expect(continueButton).toHaveCount(1);
      await expect(recovered.getByText("1 of 3 questions submitted", { exact: true })).toBeVisible();
      await expect(recovered.getByText("Resume at question 2", { exact: true })).toBeVisible();
      await continueButton.click();
      await expectQuestion(returned, attempt, 2);
      await expect(firstOption(returned)).toBeChecked();
      await expect(firstOption(returned)).toBeEnabled();
      const nav = mobileNavigation(returned);
      await nav.open();
      await questionButton(returned, 1).click();
      await nav.expectClosed();
      await expectQuestion(returned, attempt, 1);
      await expect(firstOption(returned)).toBeChecked();
      await expect(firstOption(returned)).toBeDisabled();
      await expect(returned.getByText("Progress saved", { exact: true })).toBeVisible();
      expect(creates).toEqual([]);
      const overflow = await returned.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, "no horizontal page overflow on mobile").toBe(false);
    } finally {
      await context.close();
    }
  });

  test("JHEP-89: mobile failed draft save retains input and retries without submitting", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, readAttempt, writes } = await startAttempt(page, "immediate");
    const endpoint = `/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[0].id}`;
    await page.route(`**${endpoint}`, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Save temporarily unavailable" }) });
    }, { times: 1 });
    await firstOption(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
    await expect(firstOption(page)).toBeChecked();
    await expect(firstOption(page)).toBeEnabled();
    expect((await readAttempt()).questions[0].response ?? null).toBeNull();
    await expect(page.getByText("Progress saved", { exact: true })).toHaveCount(0);
    // Explicit leave must not discard a draft. Fail its automatic retry too.
    await page.route(`**${endpoint}`, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Save temporarily unavailable" }) });
    }, { times: 1 });
    await page.getByRole("button", { name: "Save and leave", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your changes are not saved yet" })).toBeVisible();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    const retry = page.getByRole("button", { name: "Retry saving" });
    await expect(retry).toBeVisible();
    await retry.focus();
    await retry.press("Enter");
    await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
    expect((await readAttempt()).questions[0].response).toMatchObject({
      is_submitted: false, selected_option_ids: [attempt.questions[0].options[0].id],
    });
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([]);
    await page.reload();
    await expectQuestion(page, attempt, 1);
    await expect(firstOption(page)).toBeChecked();
    await expect(firstOption(page)).toBeEnabled();
  });

  test("JHEP-89: save and leave on mobile flushes drafts, then resumes the same attempt", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, readAttempt, writes } = await startAttempt(page, "immediate");
    const nav = mobileNavigation(page);
    await nav.open();
    await questionButton(page, 2).click();
    await expectQuestion(page, attempt, 2);
    await firstOption(page).click();
    const leave = page.getByRole("button", { name: "Save and leave", exact: true });
    await expect(leave).toBeVisible();
    await leave.focus();
    await leave.press("Enter");
    await expect(page).toHaveURL(/\/categories\/?$/);
    const recovered = page.getByRole("region", { name: "Continue learning" });
    await expect(recovered.getByText("0 of 3 questions submitted", { exact: true })).toBeVisible();
    await expect(recovered.getByText("Resume at question 2", { exact: true })).toBeVisible();
    const saved = await readAttempt();
    expect(saved.current_position).toBe(2);
    expect(saved.questions[1].response).toMatchObject({ is_submitted: false, selected_option_ids: [attempt.questions[1].options[0].id] });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await recovered.getByRole("button", { name: /^Continue exam/ }).click();
    await expectQuestion(page, attempt, 2);
    await expect(firstOption(page)).toBeChecked();
    await expect(firstOption(page)).toBeEnabled();
    expect(writes.filter((write) => write.startsWith("POST "))).toEqual([]);
  });

  test("JHEP-89: a stale mobile tab cannot overwrite another tab's saved draft", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { attempt, readAttempt } = await startAttempt(page, "immediate");
    const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
    if (!token) throw new Error("Missing authenticated session");
    const other = await page.context().newPage();
    try {
      await other.setViewportSize({ width: 390, height: 844 });
      // Simulate a second tab using the same authenticated browser session.
      await other.addInitScript((sessionToken) => {
        sessionStorage.setItem("jhep_auth_token", sessionToken);
      }, token);
      await other.goto(`/exams/${attempt.attempt_id}`);
      await expectQuestion(other, attempt, 1);
      const original = await readAttempt();
      expect(typeof original.recovery_revision).toBe("number");

      await firstOption(page).click();
      await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
      const confirmed = await readAttempt();
      expect(confirmed.recovery_revision).toBe((original.recovery_revision ?? -1) + 1);
      expect(confirmed.questions[0].response).toMatchObject({
        selected_option_ids: [attempt.questions[0].options[0].id], is_submitted: false,
      });

      const staleChoice = other.getByRole("radio").nth(1);
      await staleChoice.click();
      const alert = other.getByRole("alert").filter({ hasText: "Changes not saved" });
      await expect(alert).toContainText("another tab");
      await expect(staleChoice).toBeChecked();
      await expect(staleChoice).toBeEnabled();
      await expect(other.getByRole("button", { name: "Retry saving" })).toHaveCount(0);
      await other.getByRole("button", { name: "Save and leave", exact: true }).click();
      await expect(other.getByRole("alert").filter({ hasText: "Your changes are not saved yet" })).toBeVisible();
      await expectQuestion(other, attempt, 1);
      await expect(staleChoice).toBeChecked();
      const unchanged = await readAttempt();
      expect(unchanged.recovery_revision).toBe(confirmed.recovery_revision);
      expect(unchanged.questions[0].response).toEqual(confirmed.questions[0].response);

      await submitCurrentAnswer(page, attempt, 1);
      expect((await readAttempt()).questions[0].response).toMatchObject({
        selected_option_ids: [attempt.questions[0].options[0].id], is_submitted: true,
      });
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await other.close();
    }
  });


  test("JHEP-89: device recovery survives a closed mobile page before the server acknowledges", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, fixture, readAttempt } = await startAttempt(page, "immediate");
    const context = page.context();
    const endpoint = `/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[0].id}`;
    await page.route(`**${endpoint}`, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Offline draft save" }) });
    });
    await firstOption(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
    await expect(page.getByText("Pending changes backed up on this device.", { exact: true })).toBeVisible();
    expect((await readAttempt()).questions[0].response ?? null).toBeNull();
    await page.close({ runBeforeUnload: false });

    // A new page in the same browser profile retains localStorage, not the
    // closed page's sessionStorage. Authenticate normally before reading it.
    const returned = await context.newPage();
    try {
      await returned.setViewportSize({ width: 390, height: 844 });
      await returned.goto("/login");
      await returned.getByLabel("Email address").fill(fixture.email);
      await returned.getByLabel("Password", { exact: true }).fill(fixture.password);
      await returned.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(returned).toHaveURL(/\/categories\/?$/);
      await returned.getByRole("region", { name: "Continue learning" }).getByRole("button", { name: /^Continue exam/ }).click();
      await expect(returned.getByRole("heading", { name: "Recover unsaved progress" })).toBeVisible();
      await expect(returned.getByRole("heading", { name: "Recover unsaved progress" })).toBeFocused();
      await expect(returned.getByText("Ready to restore", { exact: true })).toBeVisible();
      await expect(returned.getByText(attempt.questions[0].options[0].option_text, { exact: true })).toBeVisible();
      expect(await returned.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const writes: string[] = [];
      returned.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/v1/exams")) writes.push(request.url()); });
      const restore = returned.getByRole("button", { name: "Restore this copy" });
      await restore.focus();
      await restore.press("Enter");
      await expectQuestion(returned, attempt, 1);
      await expect(firstOption(returned)).toBeChecked();
      await expect(firstOption(returned)).toBeEnabled();
      await expect(returned.getByText("Progress saved", { exact: true })).toBeVisible();
      const token = await returned.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
      const response = await returned.request.get(`/api/v1/exams/${attempt.attempt_id}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.ok()).toBe(true);
      expect((await response.json() as ExamAttempt).questions[0].response).toMatchObject({ is_submitted: false, selected_option_ids: [attempt.questions[0].options[0].id] });
      expect(writes).toEqual([]);
      await expect.poll(() => returned.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("jhep.exam-recovery.v1:")).length)).toBe(0);
    } finally {
      await returned.close();
    }
  });

  test("JHEP-89: conflicting device copy cannot replace a newer locked answer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { attempt, readAttempt } = await startAttempt(page, "immediate");
    const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
    if (!token) throw new Error("Missing authenticated session");
    const other = await page.context().newPage();
    try {
      await other.setViewportSize({ width: 390, height: 844 });
      await other.addInitScript((sessionToken) => sessionStorage.setItem("jhep_auth_token", sessionToken), token);
      await other.goto(`/exams/${attempt.attempt_id}`);
      await expectQuestion(other, attempt, 1);
      await firstOption(page).click();
      await submitCurrentAnswer(page, attempt, 1);
      const server = await readAttempt();
      await other.getByRole("radio").nth(1).click();
      await expect(other.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
      await other.getByRole("button", { name: "Review device copy" }).click();
      await expect(other.getByRole("heading", { name: "Recover unsaved progress" })).toBeVisible();
      await expect(other.getByText("Saved progress has changed", { exact: true })).toBeVisible();
      await expect(other.getByText("Server saved · Submitted (locked)", { exact: true })).toBeVisible();
      await expect(other.getByRole("button", { name: "Restore this copy" })).toHaveCount(0);
      await other.getByRole("button", { name: "Discard device copy" }).click();
      await other.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(other.getByRole("heading", { name: "Recover unsaved progress" })).toBeVisible();
      await other.getByRole("button", { name: "Discard device copy" }).click();
      await other.getByRole("button", { name: "Confirm discard" }).click();
      await expectQuestion(other, attempt, 1);
      await expect(firstOption(other)).toBeChecked();
      await expect(firstOption(other)).toBeDisabled();
      expect(await readAttempt()).toEqual(server);
    } finally {
      await other.close();
    }
  });

});
