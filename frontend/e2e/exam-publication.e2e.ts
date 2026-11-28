import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import type {
  AdminPracticeExam,
  AdminPracticeExamListResponse,
} from "../src/types/admin-practice-exam-api.types";
import type { ExamAttempt, ExamResultsResponse } from "../src/types/exam-api.types";
import type { PublishedPracticeExamListResponse } from "../src/types/practice-exam-api.types";

type Credentials = { email: string; password: string };
type PublicationFixture = {
  administrator: Credentials & { totp_secret: string };
  learner: Credentials;
  contributor: Credentials;
  certification_id: string;
  certification_name: string;
  category_id: string;
  category_name: string;
  exam_name: string;
  question_count: number;
};

const backend = path.resolve(process.cwd(), "../backend");
const python = path.join(backend, ".venv/bin/python");
const baseURL = "http://localhost:3030";
const adminExamPath = "/api/v1/admin/practice-exams";
const learnerCatalogPath = "/api/v1/exams/catalog";
const countLabel = "Question count (1–100)";

function runPython(args: string[], input?: string): string {
  const result = spawnSync(python, args, {
    cwd: backend,
    env: process.env,
    encoding: "utf8",
    input,
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `JHEP-201/107 local fixture failed: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function createFixture(): PublicationFixture {
  return JSON.parse(
    runPython(["-m", "scripts.seed_exam_publication_e2e", "--confirm-local"]),
  ) as PublicationFixture;
}

function currentTotp(secret: string): string {
  return runPython(
    ["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"],
    secret,
  );
}

async function signIn(page: Page, credentials: Credentials) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signInAdministrator(page: Page, fixture: PublicationFixture) {
  await signIn(page, fixture.administrator);
  await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(currentTotp(fixture.administrator.totp_secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/?$/);
}

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation", exact: true });
}

async function openMainNav(page: Page) {
  // The console uses a drawer below its desktop breakpoint.
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
    await menu.click();
  }
  await expect(mainNav(page)).toBeVisible();
  return mainNav(page);
}

function waitForApi(page: Page, pathname: string, method: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === method,
  );
}

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated session");
  return { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" };
}

async function authenticatedGet<T>(page: Page, pathname: string): Promise<T> {
  // APIRequestContext owns response bodies independently of browser navigation.
  const response = await page.request.get(pathname, { headers: await authHeaders(page) });
  expect(response.status(), `GET ${pathname}`).toBe(200);
  return (await response.json()) as T;
}

function examCard(page: Page, fixture: PublicationFixture) {
  return page.getByRole("region", { name: "Available practice exams" }).getByRole("article", { name: fixture.exam_name, exact: true });
}

function startButton(page: Page, fixture: PublicationFixture) {
  return examCard(page, fixture).getByRole("button", {
    name: `Start exam — ${fixture.exam_name}`,
    exact: true,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  })).toBeLessThanOrEqual(1);
}

async function expectCardCount(page: Page, fixture: PublicationFixture, count: number) {
  const card = examCard(page, fixture);
  await expect(card).toBeVisible();
  await expect(card.getByText(String(count), { exact: true })).toBeVisible();
  await expect(card.getByText(count === 1 ? "question" : "questions", { exact: true })).toBeVisible();
  await expect(startButton(page, fixture)).toBeEnabled();
  await expect(card.getByRole("spinbutton")).toHaveCount(0);
}

async function checkLearnerCatalog(
  page: Page,
  fixture: PublicationFixture,
  available: boolean,
  examId?: string,
  expectedCount = fixture.question_count,
) {
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "Select a practice exam", exact: true })).toBeVisible();
  const list = page.getByRole("region", { name: "Available practice exams" });
  const empty = page.getByText("No published practice exams are currently available.", { exact: true });
  const allInProgress = page.getByText("You have unfinished attempts for all currently available practice exams.", { exact: true });
  await expect(list.or(empty).or(allInProgress)).toBeVisible();

  const body = await authenticatedGet<PublishedPracticeExamListResponse>(page, learnerCatalogPath);
  const matches = body.exams.filter((exam) => exam.certification_id === fixture.certification_id);
  if (body.exams.length > 0) {
    await expect(list.or(allInProgress)).toBeVisible();
  } else {
    await expect(empty).toBeVisible();
  }

  if (available) {
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: examId,
      name: fixture.exam_name,
      question_count: expectedCount,
      category_id: fixture.category_id,
    });
    await expectCardCount(page, fixture, expectedCount);
  } else {
    expect(matches).toHaveLength(0);
    await expect(examCard(page, fixture)).toHaveCount(0);
  }
}

async function expectAdminAccessDenied(page: Page, exam?: AdminPracticeExam) {
  const nav = await openMainNav(page);
  await expect(nav.getByRole("link", { name: "Manage Exams", exact: true })).toHaveCount(0);
  await page.goto("/admin/practice-exams");
  await expect(page.getByRole("alert").filter({
    hasText: /^Administrator access is required to manage practice exams\.$/,
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "New exam", exact: true })).toHaveCount(0);
  const headers = await authHeaders(page);
  expect((await page.request.get(adminExamPath, { headers })).status()).toBe(403);
  if (exam) {
    const url = `${adminExamPath}/${exam.id}`;
    expect((await page.request.get(url, { headers })).status()).toBe(403);
    const response = await page.request.put(url, {
      headers,
      data: {
        name: exam.name,
        certification_id: exam.certification_id,
        category_id: exam.category_id,
        question_count: 1,
      },
    });
    expect(response.status()).toBe(403);
  }
}

async function createDraft(page: Page, fixture: PublicationFixture, count: number) {
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  const form = page.locator("#create-practice-exam");
  await expect(form).toBeVisible();
  await form.getByLabel("Exam name", { exact: true }).fill(fixture.exam_name);
  await form.getByLabel("Certification", { exact: true }).selectOption(fixture.certification_id);
  await form.getByLabel("Category", { exact: true }).selectOption(fixture.category_id);
  await form.getByLabel(countLabel, { exact: true }).fill(String(count));
  const [response] = await Promise.all([
    waitForApi(page, adminExamPath, "POST"),
    form.getByRole("button", { name: "Create draft", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit exam", exact: true })).toBeVisible();
  const records = await authenticatedGet<AdminPracticeExamListResponse>(page, adminExamPath);
  const created = records.items.filter((record) =>
    record.certification_id === fixture.certification_id && record.name === fixture.exam_name,
  );
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    name: fixture.exam_name,
    certification_id: fixture.certification_id,
    category_id: fixture.category_id,
    question_count: count,
    status: "draft",
    readiness: {
      ready: count <= fixture.question_count,
      eligible_question_count: fixture.question_count,
    },
  });
  return created[0];
}

async function changePublication(page: Page, examId: string, publish: boolean) {
  await page.getByRole("button", { name: publish ? "Publish exam" : "Unpublish exam", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const [response] = await Promise.all([
    waitForApi(page, `${adminExamPath}/${examId}/publication`, "PATCH"),
    dialog.getByRole("button", { name: publish ? "Confirm publish" : "Confirm unpublish", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: publish ? "Unpublish exam" : "Publish exam", exact: true })).toBeVisible();
  const record = await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${examId}`);
  expect(record).toMatchObject({ id: examId, status: publish ? "published" : "unpublished" });
  return record;
}

async function startNewAttempt(page: Page, fixture: PublicationFixture, examId: string, count: number) {
  const [response] = await Promise.all([
    waitForApi(page, "/api/v1/exams", "POST"),
    startButton(page, fixture).click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({
    practice_exam_id: examId,
    certification_id: fixture.certification_id,
    category_id: fixture.category_id,
    question_count: count,
  });
  await expect(page).toHaveURL(/\/exams\/[0-9a-f-]{36}\/?$/i);
  const segments = new URL(page.url()).pathname.split("/").filter(Boolean);
  const attemptId = segments[segments.length - 1];
  if (!attemptId) throw new Error("Missing attempt ID in learner route");
  const attempt = await authenticatedGet<ExamAttempt>(page, `/api/v1/exams/${attemptId}`);
  expect(attempt).toMatchObject({
    attempt_id: attemptId,
    certification_id: fixture.certification_id,
    status: "in_progress",
    question_count: count,
  });
  expect(attempt.questions).toHaveLength(count);
  await expect(page.locator("#question-heading:visible")).toHaveText(attempt.questions[0].question_text);
  return attempt;
}

function editForm(page: Page) {
  return page.locator("#edit-practice-exam");
}

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "Edit exam", exact: true }).click();
  await expect(editForm(page)).toBeVisible();
  return editForm(page);
}

async function saveEditedCount(page: Page, examId: string, count: number) {
  const form = editForm(page);
  await form.getByLabel(countLabel, { exact: true }).fill(String(count));
  const [response] = await Promise.all([
    waitForApi(page, `${adminExamPath}/${examId}`, "PUT"),
    form.getByRole("button", { name: "Save changes", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ question_count: count });
  await expect(form).toHaveCount(0);
  await expect(page.getByText(/Changes saved for/)).toBeVisible();
  const record = await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${examId}`);
  expect(record).toMatchObject({ id: examId, question_count: count });
  return record;
}

// Preserve the JHEP-201 journey, including both desktop entry points and
// non-administrator access restrictions. Use today's direct Start exam cards.
test.describe("JHEP-201 practice exam publishing journey", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("administrator can discover, create, publish and unpublish an exam through the real UI", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const fixture = createFixture();
    const learnerContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const contributorContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });

    try {
      const learner = await learnerContext.newPage();
      const contributor = await contributorContext.newPage();
      await test.step("Sign in through the normal administrator MFA flow", async () => {
        await signInAdministrator(page, fixture);
        await expect(mainNav(page).getByRole("link", { name: "Manage Exams", exact: true })).toBeVisible();
      });
      await test.step("Published questions alone do not create a learner exam", async () => {
        await signIn(learner, fixture.learner);
        await expect(learner).toHaveURL(/\/categories\/?$/);
        await checkLearnerCatalog(learner, fixture, false);
      });
      await test.step("Both administrator entry points reach the publishing interface", async () => {
        const manageLink = mainNav(page).getByRole("link", { name: "Manage Exams", exact: true });
        await expect(manageLink).toHaveAttribute("href", "/admin/practice-exams");
        await manageLink.click();
        await expect(page).toHaveURL(/\/admin\/practice-exams\/?$/);
        await expect(page.getByRole("heading", { name: "All practice exams", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: `Manage ${fixture.exam_name}`, exact: true })).toHaveCount(0);
        await mainNav(page).getByRole("link", { name: "Certifications & Categories", exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/catalog\/?$/);
        await expect(page.getByRole("heading", { name: fixture.certification_name, exact: true })).toBeVisible();
        const guidance = page.getByRole("region", { name: "Practice exam availability" });
        await expect(guidance).toContainText("does not automatically publish a practice exam");
        await guidance.getByRole("link", { name: "Open Manage Exams", exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/practice-exams\/?$/);
        await expect(page.getByRole("button", { name: "New exam", exact: true })).toBeVisible();
      });
      const draft = await test.step("Create a draft through the UI; learner catalog remains unchanged", async () => {
        const record = await createDraft(page, fixture, fixture.question_count);
        // Creation opens the details panel. The list may be hidden in the
        // single-panel layout, so verify the selected draft before switching.
        const details = page.locator('section[aria-labelledby="exam-details-heading"]:visible');
        const detailsHeading = details.locator("#exam-details-heading");
        await expect(detailsHeading).toBeVisible();
        await expect(detailsHeading).toHaveText(fixture.exam_name);
        await expect(details.getByText("Draft", { exact: true })).toBeVisible();

        const backToList = details.getByRole("button", { name: "Back to exam list", exact: true });
        const usesSinglePanel = await backToList.isVisible();
        if (usesSinglePanel) {
          await backToList.click();
          await expect(page.getByRole("heading", { name: "All practice exams", exact: true })).toBeVisible();
        }

        const examRow = page.getByRole("button", { name: `Manage ${fixture.exam_name}`, exact: true });
        await expect(examRow).toBeVisible();
        await expect(examRow).toContainText("Draft");

        if (usesSinglePanel) {
          await examRow.click();
        }
        await expect(detailsHeading).toBeVisible();
        await expect(detailsHeading).toHaveText(fixture.exam_name);
        await expect(details.getByRole("button", { name: "Publish exam", exact: true })).toBeEnabled();
        await checkLearnerCatalog(learner, fixture, false);
        return record;
      });
      await test.step("Publish the exam through the UI and verify learner availability", async () => {
        await changePublication(page, draft.id, true);
        await checkLearnerCatalog(learner, fixture, true, draft.id);
      });
      const attempt = await test.step("Start the configured exam from the learner catalog", () =>
        startNewAttempt(learner, fixture, draft.id, fixture.question_count),
      );
      const unpublished = await test.step("Unpublish through the UI; hide the exam without losing the existing attempt", async () => {
        const record = await changePublication(page, draft.id, false);
        await checkLearnerCatalog(learner, fixture, false);
        const recoveryCard = learner.getByRole("region", { name: "Continue learning" }).getByRole("article", { name: fixture.exam_name, exact: true });
        await expect(recoveryCard.getByText("In progress", { exact: true })).toBeVisible();
        await recoveryCard.getByRole("button", { name: `Continue exam — ${fixture.exam_name}`, exact: true }).click();
        await expect(learner).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/?$`));
        await expect(learner.locator("#question-heading:visible")).toHaveText(attempt.questions[0].question_text);
        const resumed = await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${attempt.attempt_id}`);
        expect(resumed).toMatchObject({ attempt_id: attempt.attempt_id, status: "in_progress", question_count: fixture.question_count });
        expect(resumed.questions.map((question) => question.id)).toEqual(attempt.questions.map((question) => question.id));
        return record;
      });
      await test.step("Learners and contributors cannot view or modify exam configurations", async () => {
        await expectAdminAccessDenied(learner, unpublished);
        await signIn(contributor, fixture.contributor);
        await expect(contributor).toHaveURL(/\/admin\/questions\/?$/);
        await expectAdminAccessDenied(contributor, unpublished);
        expect(await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${draft.id}`)).toEqual(unpublished);
      });
    } finally {
      await learnerContext.close();
      await contributorContext.close();
    }
  });
});

test.describe("JHEP-107 configurable exam length and responsive UX", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("validates and saves count, recovers stale catalog, preserves attempt and starts retake with new length", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const fixture = createFixture();
    // The existing fixture seeds two eligible questions. No extra seed data
    // or production configuration is required to prove a 1 -> 2 change.
    expect(fixture.question_count).toBe(2);
    const learnerContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
    try {
      const learner = await learnerContext.newPage();
      await signInAdministrator(page, fixture);
      const nav = await openMainNav(page);
      await nav.getByRole("link", { name: "Manage Exams", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/practice-exams\/?$/);
      await expect(page.getByRole("heading", { name: "All practice exams", exact: true })).toBeVisible();
      await signIn(learner, fixture.learner);
      await expect(learner).toHaveURL(/\/categories\/?$/);

      const draft = await test.step("Create and reopen a draft on mobile", async () => {
        const record = await createDraft(page, fixture, 1);
        await expect(page.getByRole("heading", { name: fixture.exam_name, exact: true })).toBeVisible();
        const back = page.getByRole("button", { name: "Back to exam list", exact: true });
        await expect(back).toBeVisible();
        await back.click();
        await expect(page.getByRole("heading", { name: "All practice exams", exact: true })).toBeVisible();
        await page.getByRole("button", { name: `Manage ${fixture.exam_name}`, exact: true }).click();
        await expect(page.getByRole("heading", { name: fixture.exam_name, exact: true })).toBeFocused();
        await expectNoHorizontalOverflow(page);
        await checkLearnerCatalog(learner, fixture, false);
        return record;
      });

      await test.step("Invalid counts are explained in place; cancel does not change saved data", async () => {
        const form = await openEditor(page);
        const input = form.getByLabel(countLabel, { exact: true });
        await expect(input).toHaveValue("1");
        await expect(form.getByText(/2 eligible published questions/)).toBeVisible();
        const requests: string[] = [];
        const recordWrite = (request: import("@playwright/test").Request) => {
          if (new URL(request.url()).pathname === `${adminExamPath}/${draft.id}` && request.method() === "PUT") requests.push(request.method());
        };
        page.on("request", recordWrite);
        try {
          for (const invalid of ["", "0", "101", "1.5"]) {
            await input.fill(invalid);
            await form.getByRole("button", { name: "Save changes", exact: true }).click();
            await expect(input).toHaveAttribute("aria-invalid", "true");
            await expect(page.locator("#exam-count-error")).toContainText("Enter a whole-number question count from 1 to 100.");
            await expect(input).toBeFocused();
            await expectNoHorizontalOverflow(page);
          }
          await input.fill("2");
          await form.getByRole("button", { name: "Cancel", exact: true }).click();
          await expect(form).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Edit exam", exact: true })).toBeFocused();
          expect(requests).toHaveLength(0);
        } finally {
          page.off("request", recordWrite);
        }
        expect(await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${draft.id}`)).toEqual(draft);
      });

      await test.step("Saving a valid count above the pool is allowed, but publishing is blocked", async () => {
        const form = await openEditor(page);
        await form.getByLabel(countLabel, { exact: true }).fill("3");
        await expect(form.getByText("Not enough eligible questions", { exact: true })).toBeVisible();
        await expect(form.getByText(/Requested 3; available 2/)).toBeVisible();
        await expectNoHorizontalOverflow(page);
        const blocked = await saveEditedCount(page, draft.id, 3);
        expect(blocked).toMatchObject({ status: "draft", readiness: { ready: false, required_question_count: 3, eligible_question_count: 2 } });
        await expect(page.getByRole("button", { name: "Publish exam", exact: true })).toBeDisabled();
        await expect(page.getByText(/Need 3 eligible published questions/)).toBeVisible();
        // A direct request must also be rejected; UI disabling alone is not security.
        const rejected = await page.request.patch(`${adminExamPath}/${draft.id}/publication`, {
          headers: await authHeaders(page), data: { is_published: true },
        });
        expect(rejected.status()).toBe(409);
        expect(await rejected.json()).toMatchObject({ detail: { code: "PRACTICE_EXAM_NOT_READY" } });
        await openEditor(page);
        const ready = await saveEditedCount(page, draft.id, 1);
        expect(ready.readiness.ready).toBe(true);
        await expect(page.getByRole("button", { name: "Publish exam", exact: true })).toBeEnabled();
      });

      const original = await test.step("Publish length 1 and verify the learner receives exactly one question", async () => {
        await changePublication(page, draft.id, true);
        await expect(page.getByRole("button", { name: "Edit exam", exact: true })).toHaveCount(0);
        await checkLearnerCatalog(learner, fixture, true, draft.id, 1);
        await expectNoHorizontalOverflow(learner);
        const button = startButton(learner, fixture);
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        await expect(examCard(learner, fixture).getByText("1", { exact: true })).toBeInViewport();
        const attempt = await startNewAttempt(learner, fixture, draft.id, 1);
        await expect(learner.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
        return attempt;
      });

      await test.step("Keep the original attempt and leave a stale learner catalog open", async () => {
        // Save the fixture's correct option (A) and leave the exam unfinished.
        const option = learner.getByRole("radio").first();
        await option.click();
        const [submitted] = await Promise.all([
          waitForApi(learner, `/api/v1/exams/${original.attempt_id}/responses/${original.questions[0].id}/submit`, "POST"),
          learner.getByRole("button", { name: "Submit answer", exact: true }).click(),
        ]);
        expect(submitted.status()).toBe(200);
        await expect(option).toBeDisabled();
        await learner.route("**/api/v1/exams/unfinished", (route) => route.fulfill({
          status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Recovery temporarily unavailable" }),
        }), { times: 1 });
        await checkLearnerCatalog(learner, fixture, true, draft.id, 1);
        await expect(learner.getByRole("button", { name: "Retry loading unfinished exams" })).toBeVisible();
      });
      const savedAttempt = await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${original.attempt_id}`);
      expect(savedAttempt.questions[0].response?.is_submitted).toBe(true);
      expect(savedAttempt.questions[0].response?.selected_option_ids).toEqual([original.questions[0].options[0].id]);

      await test.step("Unpublish, edit count only, then republish length 2", async () => {
        await changePublication(page, draft.id, false);
        const hidden = await authenticatedGet<PublishedPracticeExamListResponse>(learner, learnerCatalogPath);
        expect(hidden.exams.some((exam) => exam.id === draft.id)).toBe(false);
        const form = await openEditor(page);
        await expect(form.getByLabel("Exam name", { exact: true })).toBeDisabled();
        await expect(form.getByLabel("Certification", { exact: true })).toBeDisabled();
        await expect(form.getByLabel("Category", { exact: true })).toBeDisabled();
        await expect(form.getByLabel(countLabel, { exact: true })).toBeEnabled();
        await expect(form.getByText(/Existing attempts retain their original questions and order/)).toBeVisible();
        const updated = await saveEditedCount(page, draft.id, 2);
        expect(updated).toMatchObject({ status: "unpublished", question_count: 2, readiness: { ready: true } });
        await changePublication(page, draft.id, true);
      });

      await test.step("Stale count produces an inline error and explicit reload, never a silent start", async () => {
        const card = examCard(learner, fixture);
        await expect(card.getByText("1", { exact: true })).toBeVisible();
        const [rejected] = await Promise.all([
          waitForApi(learner, "/api/v1/exams", "POST"),
          startButton(learner, fixture).click(),
        ]);
        expect(rejected.status()).toBe(409);
        expect(await rejected.json()).toMatchObject({ detail: { code: "PRACTICE_EXAM_COUNT_MISMATCH", expected: 2, received: 1 } });
        await expect(card.getByRole("alert")).toContainText("The exam length has changed");
        await expect(startButton(learner, fixture)).toBeDisabled();
        await expectNoHorizontalOverflow(learner);
        await card.getByRole("button", { name: "Reload exams", exact: true }).click();
        const refreshed = await authenticatedGet<PublishedPracticeExamListResponse>(learner, learnerCatalogPath);
        expect(refreshed.exams.find((exam) => exam.id === draft.id)?.question_count).toBe(2);
        const recovery = learner.getByRole("region", { name: "Continue learning" });
        await expect(recovery.getByText("1 of 1 questions submitted", { exact: true })).toBeVisible();
        await expect(startButton(learner, fixture)).toHaveCount(0);
        await expect(learner.getByRole("button", { name: "Retry loading unfinished exams" })).toHaveCount(0);
        await expect(card.getByRole("alert")).toHaveCount(0);
        await expect(learner).toHaveURL(/\/categories\/?$/);
      });

      await test.step("Continue the original attempt, preserving its count and submitted response", async () => {
        const card = learner.getByRole("region", { name: "Continue learning" }).getByRole("article", { name: fixture.exam_name, exact: true });
        await expect(card.getByText("1 of 1 questions submitted", { exact: true })).toBeVisible();
        await expect(card.getByText("All answers submitted. Finish your exam.")).toBeVisible();
        await card.getByRole("button", { name: `Continue exam — ${fixture.exam_name}`, exact: true }).click();
        await expect(learner).toHaveURL(new RegExp(`/exams/${original.attempt_id}/?$`));
        await expect(learner.locator("#question-heading:visible")).toHaveText(original.questions[0].question_text);
        await expect(learner.getByRole("heading", { name: "Question 1 of 1", exact: true })).toBeVisible();
        expect(await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${original.attempt_id}`)).toEqual(savedAttempt);
      });

      const result = await test.step("Finish the original one-question attempt", async () => {
        // On mobile, Finish Exam lives in the question navigation disclosure.
        await learner.getByRole("button", { name: /Question navigation ·/ }).click();
        const [finished] = await Promise.all([
          waitForApi(learner, `/api/v1/exams/${original.attempt_id}/submit`, "POST"),
          learner.getByRole("button", { name: "Finish Exam", exact: true }).click(),
        ]);
        expect(finished.status()).toBe(200);
        await expect(learner).toHaveURL(new RegExp(`/exams/${original.attempt_id}/results/?$`));
        await expect(learner.getByRole("heading", { name: "Practice exam complete" })).toBeVisible();
        const stored = await authenticatedGet<ExamResultsResponse>(learner, `/api/v1/exams/${original.attempt_id}/results`);
        expect(stored).toMatchObject({ attempt_id: original.attempt_id, status: "submitted", correct_count: 1, incorrect_count: 0, score_percent: 100, passed: true });
        return stored;
      });

      await test.step("Retake uses updated count on desktop, with old results unchanged", async () => {
        await learner.getByRole("link", { name: "Back to practice exams", exact: true }).click();
        await expect(learner).toHaveURL(/\/categories\/?$/);
        await learner.setViewportSize({ width: 1440, height: 900 });
        await expectCardCount(learner, fixture, 2);
        await expectNoHorizontalOverflow(learner);
        const retake = await startNewAttempt(learner, fixture, draft.id, 2);
        expect(retake.attempt_id).not.toBe(original.attempt_id);
        expect(retake.questions.every((question) => !question.response)).toBe(true);
        expect(await authenticatedGet<ExamResultsResponse>(learner, `/api/v1/exams/${original.attempt_id}/results`)).toEqual(result);
        const prior = await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${original.attempt_id}`);
        expect(prior).toMatchObject({ status: "submitted", question_count: 1 });
        expect(prior.questions.map((question) => question.id)).toEqual(original.questions.map((question) => question.id));
      });
    } finally {
      await learnerContext.close();
    }
  });
});
