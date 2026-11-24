import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import type {
  AdminPracticeExam,
  AdminPracticeExamListResponse,
} from "../src/types/admin-practice-exam-api.types";
import type { ExamAttempt } from "../src/types/exam-api.types";
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
      `JHEP-201 local fixture failed: ${result.error?.message ?? result.stderr}`,
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

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation", exact: true });
}

function waitForApi(page: Page, pathname: string, method: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === method,
  );
}

async function authenticatedGet<T>(page: Page, pathname: string): Promise<T> {
  // APIRequestContext owns its response bodies independently of browser
  // document navigation. Use the real session token, not mocked data.
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error(`No authenticated session for GET ${pathname}`);

  const response = await page.request.get(pathname, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
  });
  expect(response.status(), `GET ${pathname}`).toBe(200);
  return (await response.json()) as T;
}

async function checkLearnerCatalog(
  page: Page,
  fixture: PublicationFixture,
  available: boolean,
  examId?: string,
) {
  // Do not capture a GET response across page.goto(): a request from the
  // previous document may match first, then lose its response body.
  // Wait for the freshly rendered catalog and read server state separately.
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "Select a practice exam", exact: true })).toBeVisible();

  const list = page.getByRole("region", { name: "Available practice exams" });
  const empty = page.getByText("No published practice exams are currently available.", { exact: true });
  await expect(list.or(empty)).toBeVisible();

  const body = await authenticatedGet<PublishedPracticeExamListResponse>(
    page, learnerCatalogPath,
  );
  const matches = body.exams.filter(
    (exam) => exam.certification_id === fixture.certification_id,
  );

  if (body.exams.length > 0) {
    await expect(
      page.getByRole("region", { name: "Available practice exams" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByText("No published practice exams are currently available.", {
        exact: true,
      }),
    ).toBeVisible();
  }

  const card = page.getByRole("button", {
    name: `View exam — ${fixture.exam_name}`,
    exact: true,
  });

  if (available) {
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: examId,
      name: fixture.exam_name,
      question_count: fixture.question_count,
      category_id: fixture.category_id,
    });
    await expect(card).toBeVisible();
    await expect(
      page.locator("article").filter({ has: card }),
    ).toContainText(`${fixture.question_count} questions per exam`);
  } else {
    expect(matches).toHaveLength(0);
    await expect(card).toHaveCount(0);
  }
}

async function expectAdminAccessDenied(page: Page) {
  // Wait for the authenticated console before asserting a link is absent.
  await expect(mainNav(page)).toBeVisible();
  await expect(mainNav(page).getByRole("link", { name: "Manage Exams", exact: true })).toHaveCount(0);
  await page.goto("/admin/practice-exams");
  // Next.js also renders an alert for route announcements. Match only
  // the actual access-denied message, not the framework announcer.
  const accessDenied = page.getByRole("alert").filter({
    hasText: /^Administrator access is required to manage practice exams\.$/,
  });
  await expect(accessDenied).toBeVisible();
  await expect(page.getByRole("button", { name: "New exam", exact: true })).toHaveCount(0);

  // The sidebar is only a discoverability control. Confirm the real backend
  // still enforces authorization for a signed-in non-administrator.
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Expected an authenticated non-admin session.");
  const response = await page.request.get(adminExamPath, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(403);
}

test.describe("JHEP-201 practice exam publishing journey", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("administrator can discover, create, publish and unpublish an exam through the real UI", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const fixture = createFixture();
    const learnerContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const contributorContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });

    try {
      const learner = await learnerContext.newPage();
      const contributor = await contributorContext.newPage();

      await test.step("Sign in through the normal administrator MFA flow", async () => {
        await signIn(page, fixture.administrator);
        await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
        await page.getByLabel("Authenticator code").fill(currentTotp(fixture.administrator.totp_secret));
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/questions\/?$/);
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

      const examId = await test.step("Create a draft through the UI; learner catalog remains unchanged", async () => {
        await page.getByRole("button", { name: "New exam", exact: true }).click();
        // Scope every field and submit action to the actual exam creation form.
        // Other route segments may still contain identically labelled filters.
        const createForm = page.locator("#create-practice-exam");
        await expect(createForm).toBeVisible();
        await createForm.getByLabel("Exam name", { exact: true }).fill(fixture.exam_name);
        await createForm.getByLabel("Certification", { exact: true }).selectOption(fixture.certification_id);
        await createForm.getByLabel("Category", { exact: true }).selectOption(fixture.category_id);
        await createForm.getByLabel("Question count (1–100)", { exact: true }).fill(String(fixture.question_count));
        const [response] = await Promise.all([
          waitForApi(page, adminExamPath, "POST"),
          createForm.getByRole("button", { name: "Create draft", exact: true }).click(),
        ]);
        expect(response.status()).toBe(201);
        const draftButton = page.getByRole("button", {
          name: `Manage ${fixture.exam_name}`, exact: true,
        });
        await expect(draftButton).toContainText("Draft");
        await expect(page.getByRole("button", { name: "Publish exam", exact: true })).toBeEnabled();

        const records = await authenticatedGet<AdminPracticeExamListResponse>(page, adminExamPath);
        const created = records.items.filter((record) =>
          record.certification_id === fixture.certification_id && record.name === fixture.exam_name,
        );
        expect(created).toHaveLength(1);
        const draft = created[0];
        expect(draft).toMatchObject({
          name: fixture.exam_name,
          certification_id: fixture.certification_id,
          category_id: fixture.category_id,
          question_count: fixture.question_count,
          status: "draft",
          readiness: { ready: true, eligible_question_count: fixture.question_count },
        });
        await checkLearnerCatalog(learner, fixture, false);
        return draft.id;
      });

      await test.step("Publish the exam through the UI and verify learner availability", async () => {
        await page.getByRole("button", { name: "Publish exam", exact: true }).click();
        const [response] = await Promise.all([
          waitForApi(page, `${adminExamPath}/${examId}/publication`, "PATCH"),
          page.getByRole("dialog").getByRole("button", { name: "Confirm publish", exact: true }).click(),
        ]);
        expect(response.status()).toBe(200);
        await expect(page.getByRole("button", { name: "Unpublish exam", exact: true })).toBeVisible();
        const published = await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${examId}`);
        expect(published).toMatchObject({ id: examId, status: "published" });
        await checkLearnerCatalog(learner, fixture, true, examId);
      });

      const attempt = await test.step("Start the configured exam from the learner catalog", async () => {
        await learner.getByRole("button", { name: `View exam — ${fixture.exam_name}`, exact: true }).click();
        const [response] = await Promise.all([
          waitForApi(learner, "/api/v1/exams", "POST"),
          learner.getByRole("button", { name: "Start Exam", exact: true }).click(),
        ]);
        expect(response.status()).toBe(201);
        // Starting an exam navigates immediately; do not read the browser
        // POST response body after the learner has left the catalog page.
        await expect(learner).toHaveURL(/\/exams\/[0-9a-f-]{36}\/?$/i);
        const segments = new URL(learner.url()).pathname.split("/").filter(Boolean);
        const attemptId = segments[segments.length - 1];
        if (!attemptId) throw new Error("Missing attempt ID in learner route");
        const attempt = await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${attemptId}`);
        expect(attempt).toMatchObject({
          attempt_id: attemptId,
          certification_id: fixture.certification_id,
          status: "in_progress",
          question_count: fixture.question_count,
        });
        expect(attempt.questions).toHaveLength(fixture.question_count);
        await expect(learner.locator("#question-heading")).toHaveText(attempt.questions[0].question_text);
        return attempt;
      });

      await test.step("Unpublish through the UI; hide the exam without losing the existing attempt", async () => {
        await page.getByRole("button", { name: "Unpublish exam", exact: true }).click();
        const [response] = await Promise.all([
          waitForApi(page, `${adminExamPath}/${examId}/publication`, "PATCH"),
          page.getByRole("dialog").getByRole("button", { name: "Confirm unpublish", exact: true }).click(),
        ]);
        expect(response.status()).toBe(200);
        await expect(page.getByRole("button", { name: "Publish exam", exact: true })).toBeVisible();
        const unpublished = await authenticatedGet<AdminPracticeExam>(page, `${adminExamPath}/${examId}`);
        expect(unpublished).toMatchObject({ id: examId, status: "unpublished" });
        await checkLearnerCatalog(learner, fixture, false);
        await learner.goto(`/exams/${attempt.attempt_id}`);
        await expect(learner.locator("#question-heading")).toHaveText(attempt.questions[0].question_text);
        const resumed = await authenticatedGet<ExamAttempt>(learner, `/api/v1/exams/${attempt.attempt_id}`);
        expect(resumed).toMatchObject({
          attempt_id: attempt.attempt_id,
          status: "in_progress",
          question_count: fixture.question_count,
        });
      });

      await test.step("Learners and contributors cannot manage exams", async () => {
        await expectAdminAccessDenied(learner);
        await signIn(contributor, fixture.contributor);
        await expect(contributor).toHaveURL(/\/admin\/questions\/?$/);
        await expectAdminAccessDenied(contributor);
      });
    } finally {
      await learnerContext.close();
      await contributorContext.close();
    }
  });
});
