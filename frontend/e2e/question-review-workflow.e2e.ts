import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { AdminQuestionDetail, AdminQuestionDraftCreateRequest, AdminQuestionDraftCreated } from "../src/types/admin-question-api.types";

type Credentials = { email: string; password: string };
type Fixture = { administrator: Credentials & { totp_secret: string }; contributor: Credentials; certification_id: string; category_id: string };
const backend = path.resolve(process.cwd(), "../backend");
const viewport = { width: 375, height: 812 };
const api = "/api/v1/admin/questions";
function runPython(args: string[], input?: string): string {
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, { cwd: backend, env: process.env, encoding: "utf8", input, timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(`Local review fixture failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function fixture(): Fixture {
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
async function createDraft(page: Page, data: Fixture, questionText: string) {
  const payload: AdminQuestionDraftCreateRequest = {
    certification_id: data.certification_id, category_id: data.category_id, difficulty: "easy",
    question_text: questionText, question_type: "multiple_choice", allows_multiple_answers: false,
    explanation: "The first answer is correct.", options: [{ option_text: "Correct", is_correct: true }, { option_text: "Incorrect", is_correct: false }], expected_answer: null,
  rubric: null,
  max_points: null,
  criteria_markdown: null,
  };
  const response = await page.request.post(api, { headers: await headers(page), data: payload });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as AdminQuestionDraftCreated;
  expect(created).toMatchObject({ review_status: "pending", publication_status: "draft" });
  return created.question_id;
}
async function openQuestion(page: Page, id: string) {
  await page.goto(`/admin/questions/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: /Question Details/ })).toBeVisible();
}
async function readQuestion(page: Page, id: string) {
  const response = await page.request.get(`${api}/${id}`, { headers: await headers(page) });
  expect(response.status()).toBe(200);
  return (await response.json()) as AdminQuestionDetail;
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function action(page: Page, id: string, endpoint: string, buttonName: string, inDialog = false) {
  const [response] = await Promise.all([
    page.waitForResponse((res) => new URL(res.url()).pathname === `${api}/${id}/${endpoint}` && res.request().method() === "POST"),
    (inDialog ? page.getByRole("dialog") : page).getByRole("button", { name: buttonName, exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
}

test("JHEP-207: role-specific review controls, feedback and mobile publication", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(viewport);
  const data = fixture();
  const context = await browser.newContext({ baseURL: "http://localhost:3030", viewport });
  try {
    const contributor = await context.newPage();
    await signIn(page, data.administrator);
    await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
    await page.getByLabel("Authenticator code").fill(runPython(["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"], data.administrator.totp_secret));
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/questions\/?$/);
    await signIn(contributor, data.contributor);
    await expect(contributor).toHaveURL(/\/admin\/questions\/?$/);

    await test.step("Administrator draft can be published directly, but not submitted for review", async () => {
      const id = await createDraft(page, data, "Administrator workflow question?");
      await openQuestion(page, id);
      await expect(page.getByRole("button", { name: "Submit for Review", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
      await noOverflow(page);
      await page.getByRole("button", { name: "Approve & Publish", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Approve and publish question?" });
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await noOverflow(page);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      expect(await readQuestion(page, id)).toMatchObject({ review_status: "pending", publication_status: "draft" });
      await page.getByRole("button", { name: "Approve & Publish", exact: true }).click();
      await action(page, id, "publish", "Confirm publish", true);
      await expect(page.getByRole("button", { name: "Retire", exact: true })).toBeVisible();
      expect(await readQuestion(page, id)).toMatchObject({ review_status: "approved", publication_status: "active" });
    });

    await test.step("Contributor submission, explicit start review, and required rework feedback", async () => {
      const id = await createDraft(contributor, data, "Contributor workflow question?");
      await openQuestion(contributor, id);
      await expect(contributor.getByRole("button", { name: "Approve & Publish", exact: true })).toHaveCount(0);
      await action(contributor, id, "submit", "Submit for Review");
      await expect(contributor.getByText("Question submitted for review.", { exact: true })).toBeVisible();
      expect(await readQuestion(contributor, id)).toMatchObject({ review_status: "submitted", publication_status: "draft" });
      await openQuestion(page, id);
      await expect(page.getByRole("button", { name: "Approve & Publish", exact: true })).toHaveCount(0);
      await action(page, id, "start-review", "Start Review");
      await expect(page.getByRole("button", { name: "Request Changes", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Request Changes", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Request changes?" });
      const input = dialog.getByLabel("Review reason (required)");
      await dialog.getByRole("button", { name: "Send feedback" }).click();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();
      await input.fill("Clarify why the first option is correct.");
      await noOverflow(page);
      await action(page, id, "request-changes", "Send feedback", true);
      await expect(dialog).toHaveCount(0);
      await openQuestion(contributor, id);
      await expect(contributor.getByText("Clarify why the first option is correct.", { exact: true })).toBeVisible();
      await expect(contributor.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
      await expect(contributor.getByRole("button", { name: "Submit for Review", exact: true })).toBeEnabled();
      const returned = await readQuestion(contributor, id);
      expect(returned).toMatchObject({ review_status: "pending", publication_status: "draft", review_note: "Clarify why the first option is correct." });
      // Exercise the existing edit API before resubmission; this test is focused
      // on review controls rather than duplicating the full question form tests.
      const edited = await contributor.request.patch(`${api}/${id}`, {
        headers: await headers(contributor),
        data: {
          category_id: returned.category_id, difficulty: returned.difficulty,
          question_text: returned.question_text, question_type: returned.question_type,
          allows_multiple_answers: returned.allows_multiple_answers,
          explanation: "The first answer is the correct choice because it matches the example in the question.",
          options: returned.options.map((option) => ({
            option_text: option.option_text,
            is_correct: option.is_correct,
          })),
          expected_answer: returned.expected_answer,
        },
      });
      expect(edited.status()).toBe(200);
      expect(await readQuestion(contributor, id)).toMatchObject({ review_status: "pending", publication_status: "draft", review_note: null });
      await openQuestion(contributor, id);
      await action(contributor, id, "submit", "Submit for Review");
      await openQuestion(page, id);
      await action(page, id, "start-review", "Start Review");
      await page.getByRole("button", { name: "Reject", exact: true }).click();
      await page.getByRole("dialog").getByLabel("Review reason (required)").fill("This question is unsuitable for the approved bank.");
      await action(page, id, "reject", "Confirm rejection", true);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openQuestion(contributor, id);
      await expect(contributor.getByText("This question is unsuitable for the approved bank.", { exact: true })).toBeVisible();
      await expect(contributor.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(contributor.getByRole("button", { name: "Submit for Review", exact: true })).toHaveCount(0);
      expect(await readQuestion(contributor, id)).toMatchObject({ review_status: "rejected", publication_status: "inactive" });
      await noOverflow(contributor);
    });
  } finally {
    await context.close();
  }
});
