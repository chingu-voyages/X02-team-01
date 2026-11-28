import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type Page, type BrowserContext } from "@playwright/test";
import { mobileNavigation } from "./helpers/exam-navigation";
import type { ExamAttempt, ExamCreatedResponse, ExamQuestionWithResponse } from "../src/types/exam-api.types";

type Fixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  question_count: number;
};
type Headers = { Authorization: string };
const baseURL = "http://localhost:3030";
const journalPrefix = "jhep.exam-recovery.v1:";

function fixture(mixed = false): Fixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const args = mixed
    ? ["-m", "scripts.seed_recovery_qa_e2e", "--confirm-local"]
    : ["-m", "scripts.seed_navigation_e2e", "--confirm-local", "--mode", "immediate"];
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, {
    cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to seed local JHEP-89 QA fixtures: ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout) as Fixture;
}

async function login(page: Page, account: Fixture): Promise<Headers> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Missing authenticated session");
  return { Authorization: `Bearer ${token}` };
}

async function readAttempt(page: Page, headers: Headers, id: string): Promise<ExamAttempt> {
  const response = await page.request.get(`/api/v1/exams/${id}`, { headers });
  expect(response.ok(), "read persisted attempt").toBe(true);
  return await response.json() as ExamAttempt;
}

async function start(page: Page, account: Fixture) {
  const headers = await login(page, account);
  const response = await page.request.post("/api/v1/exams", {
    headers,
    data: {
      certification_id: account.certification_id,
      category_id: account.category_id,
      practice_exam_id: account.practice_exam_id,
      question_count: account.question_count,
    },
  });
  expect(response.status()).toBe(201);
  const attempt = await response.json() as ExamCreatedResponse;
  await page.goto(`/exams/${attempt.attempt_id}`);
  await expect(page.locator("#question-heading")).toHaveText(attempt.questions[0].question_text);
  return { attempt, headers };
}

async function goTo(page: Page, question: ExamQuestionWithResponse) {
  // The fixture contains exactly three questions, all in the first set.
  const nav = mobileNavigation(page);
  if (await nav.trigger.isVisible()) {
    await nav.open();
    await nav.navigator.getByRole("button", { name: `Question ${question.position}`, exact: true }).click();
    await nav.expectClosed();
  } else {
    await page.getByRole("navigation", { name: "Question navigation", exact: true })
      .getByRole("button", { name: `Question ${question.position}`, exact: true }).click();
  }
  await expect(page.locator("#question-heading")).toHaveText(question.question_text);
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

function saved(page: Page) {
  return page.getByText("Progress saved", { exact: true });
}

async function journalCount(page: Page) {
  return page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).length, journalPrefix);
}

async function blockDraft(page: Page, attemptId: string, questionId: string) {
  await page.route(`**/api/v1/exams/${attemptId}/responses/${questionId}`, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA: draft save unavailable" }) });
  });
}

async function resumeFromCatalog(page: Page, id: string) {
  await page.getByRole("region", { name: "Continue learning" })
    .getByRole("button", { name: /^Continue exam/ }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${id}/?$`));
}

function findAnswer(attempt: ExamAttempt, id: string) {
  const question = attempt.questions.find((item) => item.id === id);
  if (!question) throw new Error("Missing pinned question");
  return question.response;
}

// These are additional acceptance checks, not substitutes for the 16 existing
// exam regression scenarios. All fixture accounts and question banks are new.
test.describe("JHEP-89 final recovery QA", () => {
  test("mixed drafts and position survive a full Chromium restart at 320px", async () => {
    test.setTimeout(180_000);
    const account = fixture(true);
    const profile = await mkdtemp(path.join(os.tmpdir(), "jhep89-recovery-"));
    let context: BrowserContext | undefined;
    const writtenAnswer = "Unfinished reasoning — café, 日本語, Σ.\nSecond line, with evidence.";
    try {
      context = await chromium.launchPersistentContext(profile, { baseURL, viewport: { width: 320, height: 800 }, headless: true });
      const page = context.pages()[0] ?? await context.newPage();
      const { attempt, headers } = await start(page, account);
      const loaded = await readAttempt(page, headers, attempt.attempt_id);
      const single = loaded.questions.find((q) => q.question_type === "multiple_choice" && !q.allows_multiple_answers);
      const multiple = loaded.questions.find((q) => q.question_type === "multiple_choice" && q.allows_multiple_answers);
      const written = loaded.questions.find((q) => q.question_type === "short_answer");
      if (!single || !multiple || !written) throw new Error("Mixed recovery fixture is incomplete");

      await goTo(page, single);
      await page.getByRole("radio").first().click();
      await page.getByRole("button", { name: "Submit answer", exact: true }).click();
      await expect(page.getByRole("radio").first()).toBeDisabled();
      await expect(page.getByText("Correct answer.", { exact: true })).toBeVisible();
      await goTo(page, multiple);
      await expect(saved(page)).toBeVisible();
      await blockDraft(page, attempt.attempt_id, multiple.id);
      const choices = page.getByRole("checkbox");
      await expect(choices).toHaveCount(2);
      await choices.nth(0).click();
      await choices.nth(1).click();
      await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
      await goTo(page, written);
      await page.getByRole("textbox", { name: "Your answer" }).fill(writtenAnswer);
      await expect(page.getByText("Pending changes backed up on this device.", { exact: true })).toBeVisible();
      await expect.poll(() => journalCount(page)).toBeGreaterThan(0);
      const before = await readAttempt(page, headers, attempt.attempt_id);
      expect(findAnswer(before, single.id)?.is_submitted).toBe(true);
      expect(findAnswer(before, multiple.id) ?? null).toBeNull();
      expect(findAnswer(before, written.id) ?? null).toBeNull();
      expect(before.current_position).toBe(multiple.position);

      // This closes the actual persistent Chromium process, not just a tab.
      await context.close();
      context = undefined;
      context = await chromium.launchPersistentContext(profile, { baseURL, viewport: { width: 320, height: 800 }, headless: true });
      const returned = await context.newPage();
      const renewed = await login(returned, account);
      await resumeFromCatalog(returned, attempt.attempt_id);
      const review = returned.getByRole("heading", { name: "Recover unsaved progress", exact: true });
      await expect(review).toBeFocused();
      await expect(returned.getByText("Ready to restore", { exact: true })).toBeVisible();
      // Compare both the actual UI content and the server state before restore.
      await expect(returned.getByText(writtenAnswer, { exact: true })).toBeVisible();
      await noOverflow(returned);
      expect(await readAttempt(returned, renewed, attempt.attempt_id)).toEqual(before);
      const restore = returned.getByRole("button", { name: "Restore this copy", exact: true });
      await restore.focus();
      await restore.press("Enter");
      await expect(returned.locator("#question-heading")).toHaveText(written.question_text);
      await expect(returned.getByRole("textbox", { name: "Your answer" })).toHaveValue(writtenAnswer);
      await expect(saved(returned)).toBeVisible();
      const after = await readAttempt(returned, renewed, attempt.attempt_id);
      expect(after.current_position).toBe(written.position);
      expect(findAnswer(after, written.id)).toMatchObject({ is_submitted: false, text_response: writtenAnswer });
      expect(findAnswer(after, multiple.id)).toMatchObject({ is_submitted: false, selected_option_ids: multiple.options.map((option) => option.id) });
      expect(findAnswer(after, single.id)).toEqual(findAnswer(before, single.id));
      await expect.poll(() => journalCount(returned)).toBe(0);

      // Clearing restored drafts is a write, too; do not resurrect old values.
      await returned.getByRole("textbox", { name: "Your answer" }).fill("");
      await goTo(returned, multiple);
      const restored = returned.getByRole("checkbox");
      await expect(restored.nth(0)).toBeChecked();
      await expect(restored.nth(1)).toBeChecked();
      await restored.nth(0).click();
      await restored.nth(1).click();
      await expect(saved(returned)).toBeVisible();
      await returned.reload();
      await expect(returned.locator("#question-heading")).toHaveText(multiple.question_text);
      await expect(restored.nth(0)).not.toBeChecked();
      await expect(restored.nth(1)).not.toBeChecked();
      await goTo(returned, written);
      await expect(returned.getByRole("textbox", { name: "Your answer" })).toHaveValue("");
      await expect(saved(returned)).toBeVisible();
      const cleared = await readAttempt(returned, renewed, attempt.attempt_id);
      expect(findAnswer(cleared, multiple.id) ?? null).toBeNull();
      expect(findAnswer(cleared, written.id) ?? null).toBeNull();
      expect(findAnswer(cleared, single.id)).toEqual(findAnswer(before, single.id));
      await goTo(returned, single);
      await expect(returned.getByRole("radio").first()).toBeDisabled();
      await expect(saved(returned)).toBeVisible();
      await noOverflow(returned);
    } finally {
      try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
    }
  });

  test("another authenticated learner cannot see or mutate a device-backed attempt", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const owner = fixture();
    const otherAccount = fixture();
    const { attempt, headers } = await start(page, owner);
    await blockDraft(page, attempt.attempt_id, attempt.questions[0].id);
    await page.getByRole("radio").first().click();
    await expect(page.getByText("Pending changes backed up on this device.", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
    const server = await readAttempt(page, headers, attempt.attempt_id);
    const context = page.context();
    await page.close({ runBeforeUnload: false });
    const intruder = await context.newPage();
    try {
      await intruder.setViewportSize({ width: 768, height: 1024 });
      const foreign = await login(intruder, otherAccount);
      const base = `/api/v1/exams/${attempt.attempt_id}`;
      const question = attempt.questions[0];
      const draft = { selected_option_ids: [question.options[1].id], text_response: null, expected_revision: server.recovery_revision };
      const list = await intruder.request.get("/api/v1/exams/unfinished", { headers: foreign });
      expect(list.ok()).toBe(true);
      expect(await list.json()).toEqual({ attempts: [] });
      for (const request of [
        { method: "GET", url: base },
        { method: "PUT", url: `${base}/responses/${question.id}`, data: draft },
        { method: "POST", url: `${base}/responses/${question.id}/submit`, data: draft },
        { method: "PATCH", url: `${base}/progress`, data: { current_position: 2, expected_revision: server.recovery_revision } },
        { method: "PUT", url: `${base}/questions/${question.id}/flag`, data: { flagged_for_review: true } },
        { method: "POST", url: `${base}/submit`, data: { expected_revision: server.recovery_revision } },
        { method: "GET", url: `${base}/results` },
      ]) {
        const rejected = await intruder.request.fetch(request.url, { method: request.method, headers: foreign, ...(request.data ? { data: request.data } : {}) });
        expect(rejected.status(), `${request.method} foreign attempt`).toBe(404);
        expect(await rejected.json()).toEqual({ detail: "Exam attempt not found" });
      }
      await intruder.goto(`/exams/${attempt.attempt_id}`);
      await expect(
        intruder.getByRole("alert").filter({
          hasText: "could not recover this exam",
        }),
      ).toBeVisible();
      await expect(intruder.getByRole("heading", { name: "Recover unsaved progress", exact: true })).toHaveCount(0);
      await expect(intruder.locator("#question-heading")).toHaveCount(0);
      await expect(intruder.getByRole("radio")).toHaveCount(0);
      expect(await journalCount(intruder)).toBeGreaterThan(0);
      expect(await readAttempt(intruder, headers, attempt.attempt_id)).toEqual(server);
    } finally { await intruder.close(); }
  });

  test("tampered device content is never replayed and saved answers stay unchanged", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { attempt, headers } = await start(page, fixture());
    const original = await readAttempt(page, headers, attempt.attempt_id);
    await page.evaluate(({ prefix, id, question, revision }) => {
      const token = sessionStorage.getItem("jhep_auth_token");
      if (!token) throw new Error("No session");
      const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const subject = (JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as { sub: string }).sub.toLowerCase();
      const scope = `${prefix}${subject}:${id}:`;
      localStorage.setItem(`${scope}${crypto.randomUUID()}:1`, "{corrupt-json");
      localStorage.setItem(`${scope}${crypto.randomUUID()}:1`, JSON.stringify({
        version: 1, revision, updatedAt: Date.now(),
        operations: [{ kind: "draft", questionVersionId: question, answer: { selected_option_ids: [crypto.randomUUID()], text_response: null } }],
      }));
    }, { prefix: journalPrefix, id: attempt.attempt_id, question: attempt.questions[0].id, revision: original.recovery_revision });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith(`/api/v1/exams/${attempt.attempt_id}`) && ["PUT", "PATCH", "POST"].includes(request.method())) writes.push(request.method());
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Recover unsaved progress", exact: true })).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Some device copies could not be read",
      }),
    ).toBeVisible();
    await expect(page.getByText("Unavailable selection", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore this copy", exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.getByRole("button", { name: "Continue with saved progress", exact: true }).click();
    await expect(page.locator("#question-heading")).toHaveText(attempt.questions[0].question_text);
    await expect(page.getByRole("radio").first()).not.toBeChecked();
    expect(writes).toEqual([]);
    expect(await readAttempt(page, headers, attempt.attempt_id)).toEqual(original);
  });

  test("device storage failure is explicit and does not prevent successful server retry", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((prefix) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key.startsWith(prefix)) throw new DOMException("QA quota exceeded", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    }, journalPrefix);
    const { attempt, headers } = await start(page, fixture());
    const endpoint = `**/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[0].id}`;
    await page.route(endpoint, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA network failure" }) });
    }, { times: 1 });
    await page.getByRole("radio").first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
    await expect(page.getByText("Device backup unavailable. Keep this page open until Progress saved appears.", { exact: true })).toBeVisible();
    await expect(saved(page)).toHaveCount(0);
    await expect(page.getByText("Pending changes backed up on this device.", { exact: true })).toHaveCount(0);
    expect(await journalCount(page)).toBe(0);
    await noOverflow(page);
    const retry = page.getByRole("button", { name: "Retry saving", exact: true });
    await retry.focus();
    await retry.press("Enter");
    await expect(saved(page)).toBeVisible();
    expect(findAnswer(await readAttempt(page, headers, attempt.attempt_id), attempt.questions[0].id)).toMatchObject({ is_submitted: false, selected_option_ids: [attempt.questions[0].options[0].id] });
    await page.reload();
    await expect(page.getByRole("radio").first()).toBeChecked();
    await expect(page.getByRole("heading", { name: "Recover unsaved progress", exact: true })).toHaveCount(0);
  });

  test("a committed draft with a lost acknowledgement is not resent after reopening", async ({ page }) => {
    const account = fixture();
    const { attempt, headers } = await start(page, account);
    const endpoint = `**/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[0].id}`;
    await page.route(endpoint, async (route) => {
      const committed = await route.fetch();
      expect(committed.ok(), "actual draft write committed").toBe(true);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "QA acknowledgement lost" }) });
    }, { times: 1 });
    await page.getByRole("radio").first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Changes not saved" })).toBeVisible();
    await expect(page.getByText("Pending changes backed up on this device.", { exact: true })).toBeVisible();
    const server = await readAttempt(page, headers, attempt.attempt_id);
    expect(findAnswer(server, attempt.questions[0].id)).toMatchObject({ is_submitted: false, selected_option_ids: [attempt.questions[0].options[0].id] });
    const context = page.context();
    await page.close({ runBeforeUnload: false });
    const returned = await context.newPage();
    try {
      const renewed = await login(returned, account);
      const writes: string[] = [];
      returned.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/v1/exams") && ["PUT", "PATCH", "POST"].includes(request.method())) writes.push(request.method());
      });
      await resumeFromCatalog(returned, attempt.attempt_id);
      await expect(returned.getByRole("radio").first()).toBeChecked();
      await expect(returned.getByRole("heading", { name: "Recover unsaved progress", exact: true })).toHaveCount(0);
      await expect.poll(() => journalCount(returned)).toBe(0);
      expect(await readAttempt(returned, renewed, attempt.attempt_id)).toEqual(server);
      expect(writes).toEqual([]);
    } finally { await returned.close(); }
  });
});
