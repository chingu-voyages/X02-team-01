import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { AdminPracticeExam, AdminPracticeExamListResponse } from "../src/types/admin-practice-exam-api.types";
import type { ExamAttempt } from "../src/types/exam-api.types";
import type { PublishedPracticeExamListResponse } from "../src/types/practice-exam-api.types";

type Credentials = { email: string; password: string };
type Fixture = {
  administrator: Credentials & { totp_secret: string };
  learner: Credentials;
  certification_id: string;
  category_id: string;
  exam_name: string;
};

const backend = path.resolve(process.cwd(), "../backend");
const adminPath = "/api/v1/admin/practice-exams";
const viewport = { width: 375, height: 812 };

function runPython(args: string[], input?: string): string {
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, {
    cwd: backend, env: process.env, encoding: "utf8", input, timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to seed JHEP-207 deletion fixture: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

function createFixture(): Fixture {
  return JSON.parse(runPython(["-m", "scripts.seed_exam_publication_e2e", "--confirm-local"])) as Fixture;
}

async function signIn(page: Page, credentials: Credentials) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function headers(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated session");
  return { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" };
}

async function read<T>(page: Page, pathname: string): Promise<T> {
  const response = await page.request.get(pathname, { headers: await headers(page) });
  expect(response.status(), `GET ${pathname}`).toBe(200);
  return (await response.json()) as T;
}

function waitForApi(page: Page, pathname: string, method: string) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === method);
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function createDraft(page: Page, fixture: Fixture, name: string) {
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  const form = page.locator("#create-practice-exam");
  await form.getByLabel("Exam name", { exact: true }).fill(name);
  await form.getByLabel("Certification", { exact: true }).selectOption(fixture.certification_id);
  await form.getByLabel("Category", { exact: true }).selectOption(fixture.category_id);
  await form.getByLabel("Question count (1–100)", { exact: true }).fill("1");
  const [response] = await Promise.all([
    waitForApi(page, adminPath, "POST"),
    form.getByRole("button", { name: "Create draft", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const listing = await read<AdminPracticeExamListResponse>(page, adminPath);
  const exam = listing.items.find((item) => item.name === name && item.certification_id === fixture.certification_id);
  if (!exam) throw new Error("Created exam not found");
  expect(exam).toMatchObject({ status: "draft", question_count: 1 });
  return exam;
}

async function publication(page: Page, exam: AdminPracticeExam, publish: boolean) {
  await page.getByRole("button", { name: publish ? "Publish exam" : "Unpublish exam", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const [response] = await Promise.all([
    waitForApi(page, `${adminPath}/${exam.id}/publication`, "PATCH"),
    dialog.getByRole("button", { name: publish ? "Confirm publish" : "Confirm unpublish", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: publish ? "Unpublish exam" : "Publish exam", exact: true })).toBeVisible();
}

async function openDeletion(page: Page, exam: AdminPracticeExam) {
  await page.getByRole("button", { name: "Delete exam", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete practice exam?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(exam.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText("This action cannot be undone.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await noOverflow(page);
  return dialog;
}

test("JHEP-207: mobile exam deletion is confirmed, unused exams are removed, and learner attempts are protected", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(viewport);
  const fixture = createFixture();
  const learnerContext = await browser.newContext({ baseURL: "http://localhost:3030", viewport });
  try {
    const learner = await learnerContext.newPage();
    await signIn(page, fixture.administrator);
    await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
    const code = runPython(["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"], fixture.administrator.totp_secret);
    await page.getByLabel("Authenticator code").fill(code);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/questions\/?$/);
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
    await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Manage Exams", exact: true }).click();
    await expect(page.getByRole("heading", { name: "All practice exams", exact: true })).toBeVisible();

    await test.step("Cancel a deletion, then permanently delete the unused draft", async () => {
      const draft = await createDraft(page, fixture, `${fixture.exam_name} unused`);
      let dialog = await openDeletion(page, draft);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete exam", exact: true })).toBeFocused();
      expect(await read<AdminPracticeExam>(page, `${adminPath}/${draft.id}`)).toEqual(draft);
      dialog = await openDeletion(page, draft);
      const [deleted] = await Promise.all([
        waitForApi(page, `${adminPath}/${draft.id}`, "DELETE"),
        dialog.getByRole("button", { name: "Confirm delete", exact: true }).click(),
      ]);
      expect(deleted.status()).toBe(204);
      await expect(dialog).toHaveCount(0);
      const listHeading = page.getByRole("heading", { name: "All practice exams", exact: true });
      await expect(listHeading).toBeVisible();
      await expect(listHeading).toBeFocused();
      await expect(page.getByRole("status").filter({ hasText: "was deleted successfully" })).toBeVisible();
      await expect(page.getByRole("button", { name: `Manage ${draft.name}`, exact: true })).toHaveCount(0);
      expect((await page.request.get(`${adminPath}/${draft.id}`, { headers: await headers(page) })).status()).toBe(404);
      await noOverflow(page);
    });

    const protectedExam = await test.step("Create another exam from the same question bank and publish it", async () => {
      // The first delete must not have removed the category or its questions.
      const exam = await createDraft(page, fixture, `${fixture.exam_name} protected`);
      expect(exam.readiness.eligible_question_count).toBe(2);
      await publication(page, exam, true);
      await expect(page.getByRole("button", { name: "Delete exam", exact: true })).toBeDisabled();
      await expect(page.getByText("Unpublish this exam before deleting it.")).toBeVisible();
      return exam;
    });

    const before = await test.step("Start an attempt and save an answer as a learner", async () => {
      await signIn(learner, fixture.learner);
      await expect(learner).toHaveURL(/\/categories\/?$/);
      const card = learner.getByRole("article", { name: protectedExam.name, exact: true });
      const [started] = await Promise.all([
        waitForApi(learner, "/api/v1/exams", "POST"),
        card.getByRole("button", { name: `Start exam — ${protectedExam.name}`, exact: true }).click(),
      ]);
      expect(started.status()).toBe(201);
      await expect(learner).toHaveURL(/\/exams\/[0-9a-f-]{36}\/?$/i);
      const attemptId = new URL(learner.url()).pathname.split("/").filter(Boolean).pop();
      if (!attemptId) throw new Error("Missing attempt ID");
      const attempt = await read<ExamAttempt>(learner, `/api/v1/exams/${attemptId}`);
      expect(attempt.question_count).toBe(1);
      await expect(learner.locator("#question-heading:visible")).toHaveText(attempt.questions[0].question_text);
      await learner.getByRole("radio").first().click();
      const [saved] = await Promise.all([
        waitForApi(learner, `/api/v1/exams/${attemptId}/responses/${attempt.questions[0].id}/submit`, "POST"),
        learner.getByRole("button", { name: "Submit answer", exact: true }).click(),
      ]);
      expect(saved.status()).toBe(200);
      const record = await read<ExamAttempt>(learner, `/api/v1/exams/${attemptId}`);
      expect(record.questions[0].response?.is_submitted).toBe(true);
      return record;
    });

    await test.step("Unpublish and reject deletion without losing learner history", async () => {
      await publication(page, protectedExam, false);
      const dialog = await openDeletion(page, { ...protectedExam, status: "unpublished" });
      const [rejected] = await Promise.all([
        waitForApi(page, `${adminPath}/${protectedExam.id}`, "DELETE"),
        dialog.getByRole("button", { name: "Confirm delete", exact: true }).click(),
      ]);
      expect(rejected.status()).toBe(409);
      expect(await rejected.json()).toMatchObject({ detail: { code: "PRACTICE_EXAM_HAS_ATTEMPTS" } });
      await expect(dialog).toHaveCount(0);
      const deletion = page.getByRole("region", { name: "Delete practice exam", exact: true });
      await expect(deletion.getByRole("alert")).toContainText("This exam has learner attempts");
      await expect(deletion.getByRole("button", { name: "Delete exam", exact: true })).toBeDisabled();
      await noOverflow(page);
      expect(await read<AdminPracticeExam>(page, `${adminPath}/${protectedExam.id}`)).toMatchObject({ id: protectedExam.id, status: "unpublished" });
      const catalog = await read<PublishedPracticeExamListResponse>(learner, "/api/v1/exams/catalog");
      expect(catalog.exams.some((exam) => exam.id === protectedExam.id)).toBe(false);
      expect(await read<ExamAttempt>(learner, `/api/v1/exams/${before.attempt_id}`)).toEqual(before);
    });
  } finally {
    await learnerContext.close();
  }
});
