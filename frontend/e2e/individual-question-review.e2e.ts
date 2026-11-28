import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ExamCreatedResponse, ExamQuestion } from "../src/types/exam-api.types";
import type { CompletedQuestionReview } from "../src/types/exam-question-review.types";
import type { ReviewStatus } from "../src/types/exam-review.types";

const names = ["single_correct", "single_wrong", "single_unanswered", "multi_correct", "multi_partial", "written"] as const;
type Name = (typeof names)[number];
type Mode = "immediate" | "deferred";
type Fixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  question_count: number;
  versions: Record<Name, string>;
};
type Headers = { Authorization: string };
const writtenAnswer = "My recorded response: Δx² = 4 · 日本語 · مرحبا\n" + "Z".repeat(220);
const statuses: Record<Name, ReviewStatus> = {
  single_correct: "correct", single_wrong: "incorrect", single_unanswered: "unanswered",
  multi_correct: "correct", multi_partial: "incorrect", written: "pending_manual_grading",
};
const statusLabels: Record<ReviewStatus, string> = {
  correct: "Correct", incorrect: "Incorrect", unanswered: "Unanswered",
  pending_manual_grading: "Pending Grading", manually_graded: "Manually graded", unavailable: "Not graded",
};
const selectedPositions: Record<Name, number[]> = {
  single_correct: [1], single_wrong: [2], single_unanswered: [], multi_correct: [1, 3], multi_partial: [1, 2], written: [],
};
// A real PNG served by the browser test, not by production object storage.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR4nGOUm+bNQA3ARBVTRg0aNWjUoBFsEADXEQEfkAewOgAAAABJRU5ErkJggg==", "base64");

function localFixture<T>(...args: string[]): T {
  const backend = path.resolve(process.cwd(), "../backend");
  const result = spawnSync(path.join(backend, ".venv/bin/python"), ["-m", "scripts.seed_question_review_e2e", "--confirm-local", ...args], {
    cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000,
  });
  if (result.error || result.status !== 0) throw new Error(`Unable to prepare JHEP-72 local fixture: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout) as T;
}

async function login(page: Page, fixture: Fixture): Promise<Headers> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Learner login did not establish a session");
  return { Authorization: `Bearer ${token}` };
}

function urls(attempt: ExamCreatedResponse) {
  const base = `/exams/${attempt.attempt_id}`;
  return {
    api: `/api/v1${base}`, results: `${base}/results`, list: `${base}/review`,
    detail: (versionId: string) => `${base}/review/questions/${versionId}`,
    detailApi: (versionId: string) => `/api/v1${base}/review/questions/${versionId}`,
  };
}

function questionFor(attempt: ExamCreatedResponse, fixture: Fixture, name: Name): ExamQuestion {
  const question = attempt.questions.find((item) => item.id === fixture.versions[name]);
  if (!question) throw new Error(`Missing fixture question ${name}`);
  return question;
}

function optionIds(question: ExamQuestion, positions: number[]) {
  return positions.map((position) => {
    const option = question.options.find((item) => item.position === position);
    if (!option) throw new Error(`Missing option ${position} for question ${question.id}`);
    return option.id;
  });
}

async function create(page: Page, fixture: Fixture, headers: Headers) {
  const response = await page.request.post("/api/v1/exams", {
    headers, data: { certification_id: fixture.certification_id, category_id: fixture.category_id,
      practice_exam_id: fixture.practice_exam_id, question_count: fixture.question_count },
  });
  expect(response.status(), "create a published fixture exam").toBe(201);
  const attempt = (await response.json()) as ExamCreatedResponse;
  expect(attempt.questions).toHaveLength(6);
  expect(attempt.questions.map((item) => item.id).sort()).toEqual(Object.values(fixture.versions).sort());
  return attempt;
}

async function finish(page: Page, attempt: ExamCreatedResponse, fixture: Fixture, headers: Headers, mode: Mode) {
  for (const name of names) {
    if (name === "single_unanswered") continue;
    const question = questionFor(attempt, fixture, name);
    const response = await page.request.post(`${urls(attempt).api}/responses/${question.id}/submit`, {
      headers, data: name === "written" ? { text_response: writtenAnswer } : { selected_option_ids: optionIds(question, selectedPositions[name]) },
    });
    expect(response.ok(), `submit ${name}`).toBe(true);
    const feedback = await response.json();
    if (mode === "deferred") {
      expect(feedback.feedback_released).toBe(false);
      expect(feedback.correct_option_ids ?? null).toBeNull();
      expect(feedback.explanation ?? null).toBeNull();
    }
    // Even individually submitted questions cannot use completed review early.
    const early = await page.request.get(urls(attempt).detailApi(question.id), { headers });
    expect(early.status()).toBe(409);
    expect(await early.text()).not.toContain(question.question_text);
  }
  const submitted = await page.request.post(`${urls(attempt).api}/submit`, { headers });
  expect(submitted.ok()).toBe(true);
  expect(await submitted.json()).toMatchObject({ attempt_id: attempt.attempt_id, status: "submitted" });
}

async function setup(page: Page, mode: Mode, complete = true) {
  const fixture = localFixture<Fixture>("--mode", mode);
  const headers = await login(page, fixture);
  const attempt = await create(page, fixture, headers);
  if (complete) await finish(page, attempt, fixture, headers, mode);
  return { fixture, headers, attempt };
}

async function detailApi(page: Page, attempt: ExamCreatedResponse, versionId: string, headers: Headers) {
  const response = await page.request.get(urls(attempt).detailApi(versionId), { headers });
  expect(response.status(), "read protected detail").toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const detail = (await response.json()) as CompletedQuestionReview;
  expect(detail.attempt_id).toBe(attempt.attempt_id);
  expect(detail.attempt_status).toBe("submitted");
  expect(detail.question_version_id).toBe(versionId);
  expect(JSON.stringify(detail)).not.toContain("JHEP72-PRIVATE-WRITTEN-KEY");
  return detail;
}

async function snapshot(page: Page, attempt: ExamCreatedResponse, headers: Headers) {
  const responses = await Promise.all([page.request.get(urls(attempt).api, { headers }), page.request.get(`${urls(attempt).api}/results`, { headers })]);
  for (const response of responses) expect(response.ok()).toBe(true);
  return Promise.all(responses.map((response) => response.json()));
}

function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/^\/api\/v1\/exams(?:\/|$)/.test(new URL(request.url()).pathname) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  return writes;
}

const back = (page: Page) => page.getByRole("link", { name: "Back to questions", exact: true });
const list = (page: Page) => page.getByRole("list", { name: "Completed exam questions", exact: true });
const recorded = (page: Page) => page.getByRole("list", { name: "Recorded answer options", exact: true });
const visibleText = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true });

async function alert(page: Page, message: string) {
  await expect(page.getByRole("alert").filter({ hasText: message })).toHaveText(message);
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function assertDetail(page: Page, detail: CompletedQuestionReview) {
  await expect(page.getByRole("heading", { level: 1, name: `Question ${detail.position} of ${detail.question_count}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: detail.question_text, exact: true })).toBeVisible();
  await expect(visibleText(page, statusLabels[detail.question_status])).toBeVisible();
  await expect(back(page)).toHaveAttribute("href", `/exams/${detail.attempt_id}/review`);
  const original = page.getByRole("region", { name: detail.question_text, exact: true });
  for (const role of ["radio", "checkbox", "textbox"] as const) await expect(original.getByRole(role)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /submit answer|finish exam/i })).toHaveCount(0);
  const explanation = page.getByRole("region", { name: "Explanation", exact: true });
  if (detail.explanation) {
    await expect(explanation).toBeVisible();
    await expect(explanation.getByText(detail.explanation, { exact: true })).toBeVisible();
  } else await expect(explanation).toHaveCount(0);
  if (detail.question_type === "short_answer") {
    await expect(recorded(page)).toHaveCount(0);
    await expect(visibleText(page, writtenAnswer)).toBeVisible();
    await expect(visibleText(page, "Your answer is awaiting manual grading. Return here after it has been reviewed.")).toBeVisible();
  } else {
    const rows = recorded(page).getByRole("listitem");
    await expect(rows).toHaveCount(detail.options.length);
    for (const [index, option] of detail.options.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute("value", String(option.position));
      await expect(row.getByText(option.option_text, { exact: true })).toBeVisible();
      const selected = detail.submitted_response?.selected_option_ids.includes(option.id) ?? false;
      const correct = detail.correct_option_ids?.includes(option.id) ?? false;
      await expect(row.getByText("Your answer", { exact: true })).toHaveCount(selected ? 1 : 0);
      await expect(row.getByText("Correct answer", { exact: true })).toHaveCount(correct && selected ? 1 : 0);
      await expect(row.getByText("Correct answer · Not selected", { exact: true })).toHaveCount(correct && !selected ? 1 : 0);
      await expect(row.getByText("Incorrect selection", { exact: true })).toHaveCount(detail.correct_option_ids && selected && !correct ? 1 : 0);
    }
    if (!detail.submitted_response) await expect(visibleText(page, "You did not submit an answer.")).toBeVisible();
  }
}

async function openFromList(page: Page, attempt: ExamCreatedResponse, detail: CompletedQuestionReview, keyboard = false) {
  const link = list(page).getByRole("link", { name: `Review question ${detail.position}: ${statusLabels[detail.question_status]}`, exact: true });
  await expect(link).toHaveAttribute("href", urls(attempt).detail(detail.question_version_id));
  if (keyboard) {
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
  } else await link.click();
  await expect(page).toHaveURL(new RegExp(`${urls(attempt).detail(detail.question_version_id)}/?$`));
  await assertDetail(page, detail);
}

test.describe("JHEP-72 individual completed question review", () => {
  const browserErrors = new WeakMap<Page, string[]>();
  test.beforeEach(({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    browserErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i.test(message.text())) errors.push(message.text());
    });
  });
  test.afterEach(({ page }) => expect(browserErrors.get(page) ?? [], "uncaught browser and hydration errors").toEqual([]));

  for (const mode of ["immediate", "deferred"] as const) {
    test(`${mode}: real results → all six question cases → list, refresh and immutable results`, async ({ page }) => {
      const { fixture, attempt, headers } = await setup(page, mode);
      const details: CompletedQuestionReview[] = [];
      for (const name of names) {
        const question = questionFor(attempt, fixture, name);
        const detail = await detailApi(page, attempt, question.id, headers);
        expect(detail).toMatchObject({ position: question.position, question_count: 6, question_text: question.question_text, question_status: statuses[name], options: question.options });
        const selected = optionIds(question, selectedPositions[name]);
        expect([...(detail.submitted_response?.selected_option_ids ?? [])].sort()).toEqual([...selected].sort());
        if (name === "written") {
          expect(detail.submitted_response?.text_response).toBe(writtenAnswer);
          expect(detail.correct_option_ids).toBeNull();
        } else {
          const key = optionIds(question, question.allows_multiple_answers ? [1, 3] : [1]);
          expect([...(detail.correct_option_ids ?? [])].sort()).toEqual([...key].sort());
          expect(detail.grading?.points_earned).toBe(statuses[name] === "correct" ? 1 : 0);
        }
        expect(detail.explanation === null).toBe(name === "single_wrong");
        details.push(detail);
      }
      const image = details.find((item) => item.question_version_id === fixture.versions.multi_partial)?.images[0];
      expect(image?.alt_text).toBe("JHEP-72 fixture diagram");
      // If an R2 base exists, supply a deterministic local image response.
      // If not, the same UI must show the original alt-text fallback.
      if (image?.url) await page.route(image.url, (route) => route.fulfill({ contentType: "image/png", body: png }));
      const before = await snapshot(page, attempt, headers);
      const writes = trackWrites(page);
      await page.goto(urls(attempt).results);
      await page.getByRole("link", { name: "Review Answers", exact: true }).click();
      await expect(list(page).getByRole("listitem")).toHaveCount(6);
      for (const [index, detail] of details.sort((a, b) => a.position - b.position).entries()) {
        await openFromList(page, attempt, detail, index === 0);
        if (detail.position === 1) {
          await expect(page.getByRole("link", { name: "Previous question", exact: true })).toHaveCount(0);
          await expect(visibleText(page, "First question")).toBeVisible();
        }
        if (detail.position === 6) await expect(page.getByRole("link", { name: "Back to question list", exact: true })).toHaveAttribute("href", urls(attempt).list);
        if (detail.question_version_id === fixture.versions.multi_partial) {
          if (image?.url) {
            const diagram = page.getByRole("img", { name: "JHEP-72 fixture diagram", exact: true });
            await expect(diagram).toBeVisible();
            await expect.poll(() => diagram.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          } else {
            await expect(visibleText(page, "Image unavailable")).toBeVisible();
            await expect(visibleText(page, "JHEP-72 fixture diagram")).toBeVisible();
          }
          for (const width of [320, 375, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 800 });
            await expectNoOverflow(page);
            const controls = [back(page), page.getByRole("navigation", { name: "Review question navigation" }).getByRole("link")];
            for (const group of controls) for (const control of await group.all()) expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
            await page.getByRole("heading", { name: "Explanation", exact: true }).scrollIntoViewIfNeeded();
            await expect(page.getByRole("heading", { name: "Explanation", exact: true })).toBeInViewport();
          }
          await page.reload();
          await assertDetail(page, detail);
        }
        await back(page).click();
        await expect(list(page).getByRole("listitem")).toHaveCount(6);
      }
      await openFromList(page, attempt, details[0]);
      await back(page).focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Next question", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await assertDetail(page, details[1]);
      await page.getByRole("link", { name: "Previous question", exact: true }).click();
      await assertDetail(page, details[0]);
      await page.goBack();
      await assertDetail(page, details[1]);
      await page.goForward();
      await assertDetail(page, details[0]);
      expect(await snapshot(page, attempt, headers)).toEqual(before);
      expect(writes).toEqual([]);
    });
  }

  test("security: reject early, anonymous, foreign and unassigned detail access and mutation", async ({ page, browser }) => {
    const { fixture, attempt, headers } = await setup(page, "deferred", false);
    const version = fixture.versions.single_correct;
    const api = urls(attempt).detailApi(version);
    const ui = urls(attempt).detail(version);
    const question = questionFor(attempt, fixture, "single_correct");
    await page.goto(ui);
    await alert(page, "This question cannot be reviewed. Make sure the exam is completed.");
    await expect(recorded(page)).toHaveCount(0);
    await finish(page, attempt, fixture, headers, "deferred");
    const before = await snapshot(page, attempt, headers);
    const stranger = localFixture<Fixture>("--mode", "immediate");
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const other = await context.newPage();
      const anonymous = await other.request.get(api);
      expect(anonymous.status()).toBe(401);
      await other.goto(ui);
      await expect(other).toHaveURL(/\/login(?:\?|$)/);
      const otherHeaders = await login(other, stranger);
      const denied = await other.request.get(api, { headers: otherHeaders });
      const unknown = await page.request.get(`/api/v1/exams/${randomUUID()}/review/questions/${version}`, { headers });
      const unassigned = await page.request.get(urls(attempt).detailApi(stranger.versions.single_correct), { headers });
      for (const response of [denied, unknown, unassigned]) {
        expect(response.status()).toBe(404);
        expect(await response.json()).toEqual({ detail: "Exam attempt not found" });
        expect(await response.text()).not.toContain(question.question_text);
      }
      await other.goto(ui);
      await alert(other, "This question review is unavailable.");
      await expect(recorded(other)).toHaveCount(0);
      await expect(other.getByRole("button", { name: "Retry loading question" })).toHaveCount(0);
      await expect(back(other)).toBeVisible();
    } finally { await context.close(); }
    await page.goto(urls(attempt).detail("invalid-id"));
    await alert(page, "Invalid question review link.");
    await expect(back(page)).toBeVisible();
    await page.goto(urls(attempt).detail(stranger.versions.single_correct));
    await alert(page, "This question review is unavailable.");
    await expect(recorded(page)).toHaveCount(0);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await page.request.fetch(api, { headers, method });
      expect(response.status(), `${method} must not mutate the detail endpoint`).toBe(405);
    }
    const edit = await page.request.put(`${urls(attempt).api}/responses/${version}`, { headers, data: { selected_option_ids: optionIds(question, [2]) } });
    expect(edit.status(), "existing answer API rejects edits to completed attempts").toBe(409);
    await page.goto(ui);
    await assertDetail(page, await detailApi(page, attempt, version, headers));
    expect(await snapshot(page, attempt, headers)).toEqual(before);
  });

  test("historical: new bank version cannot alter an original completed review", async ({ page }) => {
    const { fixture, attempt, headers } = await setup(page, "immediate");
    const original = fixture.versions.single_correct;
    const detail = await detailApi(page, attempt, original, headers);
    await page.goto(urls(attempt).detail(original));
    await assertDetail(page, detail);
    const before = await snapshot(page, attempt, headers);
    const { replacement_id: replacementId } = localFixture<{ replacement_id: string }>("--attempt-id", attempt.attempt_id, "--replace-version", original);
    expect(replacementId).not.toBe(original);
    const after = await detailApi(page, attempt, original, headers);
    expect(after).toEqual(detail);
    await page.reload();
    await assertDetail(page, detail);
    await expect(page.getByText(/JHEP72-REPLACEMENT/).filter({ visible: true })).toHaveCount(0);
    const denied = await page.request.get(urls(attempt).detailApi(replacementId), { headers });
    expect(denied.status()).toBe(404);
    expect(await snapshot(page, attempt, headers)).toEqual(before);
  });

  test("recovery: loading, network failure, mismatched data, image success and fallback", async ({ page }) => {
    const { fixture, attempt, headers } = await setup(page, "deferred");
    const version = fixture.versions.multi_partial;
    const detail = await detailApi(page, attempt, version, headers);
    expect(detail.images).toHaveLength(1);
    const before = await snapshot(page, attempt, headers);
    const writes = trackWrites(page);
    const simulatedImage = new URL("/jhep72-test-image.png", page.url()).href;
    let imageFailure = false;
    await page.route(simulatedImage, (route) => imageFailure ? route.fulfill({ status: 404, body: "not found" }) : route.fulfill({ contentType: "image/png", body: png }));
    type State = "fail" | "foreign" | "image";
    const simulation: { state: State } = { state: "fail" };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**${urls(attempt).detailApi(version)}`, async (route) => {
      if (simulation.state === "fail") { await gate; await route.abort("failed"); }
      else if (simulation.state === "foreign") await route.fulfill({ json: { ...detail, question_version_id: randomUUID() } });
      else await route.fulfill({ json: { ...detail, images: [{ ...detail.images[0], url: simulatedImage }] } });
    });
    try {
      await page.goto(urls(attempt).detail(version), { waitUntil: "domcontentloaded" });
      await expect(back(page)).toBeVisible();
      await expect(visibleText(page, "Loading question review...")).toBeVisible();
      await expect(recorded(page)).toHaveCount(0);
    } finally { release(); }
    await alert(page, "Unable to load question review. Please try again.");
    simulation.state = "foreign";
    await page.getByRole("button", { name: "Retry loading question", exact: true }).click();
    await alert(page, "Unable to load question review. Please try again.");
    await expect(recorded(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: detail.question_text, exact: true })).toHaveCount(0);
    simulation.state = "image";
    await page.getByRole("button", { name: "Retry loading question", exact: true }).click();
    await assertDetail(page, detail);
    const diagram = page.getByRole("img", { name: "JHEP-72 fixture diagram", exact: true });
    await expect(diagram).toBeVisible();
    await expect.poll(() => diagram.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    imageFailure = true;
    await page.reload();
    await assertDetail(page, detail);
    await expect(visibleText(page, "Image unavailable")).toBeVisible();
    await expect(visibleText(page, "JHEP-72 fixture diagram")).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });
    await expectNoOverflow(page);
    await back(page).click();
    await expect(list(page).getByRole("listitem")).toHaveCount(6);
    expect(await snapshot(page, attempt, headers)).toEqual(before);
    expect(writes).toEqual([]);
  });

  test.describe("touch-enabled mobile browser", () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

    test("tap a question, read long content and return without losing results", async ({ page }) => {
      const { fixture, attempt, headers } = await setup(page, "immediate");
      const detail = await detailApi(page, attempt, fixture.versions.multi_partial, headers);
      const image = detail.images[0];
      if (image?.url) await page.route(image.url, (route) => route.fulfill({ contentType: "image/png", body: png }));
      const before = await snapshot(page, attempt, headers);
      const writes = trackWrites(page);
      await page.goto(urls(attempt).list);
      const question = list(page).getByRole("link", { name: `Review question ${detail.position}: Incorrect`, exact: true });
      await expect(question).toBeVisible();
      expect((await question.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await question.tap();
      await assertDetail(page, detail);
      await expectNoOverflow(page);
      const nav = page.getByRole("navigation", { name: "Review question navigation" });
      const neighbor = attempt.questions.find((item) => item.position === (detail.position === 6 ? detail.position - 1 : detail.position + 1));
      if (!neighbor) throw new Error("Expected an adjacent fixture question");
      const next = nav.getByRole("link", { name: detail.position === 6 ? "Previous question" : "Next question", exact: true });
      await next.scrollIntoViewIfNeeded();
      expect((await next.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await next.tap();
      await assertDetail(page, await detailApi(page, attempt, neighbor.id, headers));
      await back(page).tap();
      await expect(list(page).getByRole("listitem")).toHaveCount(6);
      await page.getByRole("link", { name: "Back to Results", exact: true }).tap();
      await expect(page).toHaveURL(new RegExp(`${urls(attempt).results}/?$`));
      await expect(page.getByRole("link", { name: "Review Answers", exact: true })).toBeVisible();
      expect(await snapshot(page, attempt, headers)).toEqual(before);
      expect(writes).toEqual([]);
    });
  });
});
