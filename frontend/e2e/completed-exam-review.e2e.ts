import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  ExamCreatedResponse,
  ExamQuestion,
  ExamResultsResponse,
} from "../src/types/exam-api.types";
import type {
  CompletedExamReview,
  ReviewStatus,
} from "../src/types/exam-review.types";

type FixtureMode = "immediate" | "deferred" | "mixed";
type Fixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  question_count: number;
};
type AuthHeaders = { Authorization: string };

const labels: Record<ReviewStatus, string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  unanswered: "Unanswered",
  pending_manual_grading: "Pending Grading",
  manually_graded: "Manually graded",
  unavailable: "Not graded",
};

function seed(mode: FixtureMode): Fixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const args = mode === "mixed"
    ? ["-m", "scripts.seed_completed_review_e2e", "--confirm-local"]
    : ["-m", "scripts.seed_navigation_e2e", "--confirm-local", "--mode", mode];
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, {
    cwd: backend,
    env: process.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to seed JHEP-37 ${mode} fixture. ${result.error?.message ?? result.stderr}`);
  }
  return JSON.parse(result.stdout) as Fixture;
}

async function login(page: Page, fixture: Fixture): Promise<AuthHeaders> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Login did not establish a learner session");
  return { Authorization: `Bearer ${token}` };
}

async function createAttempt(page: Page, fixture: Fixture, headers: AuthHeaders) {
  const response = await page.request.post("/api/v1/exams", {
    headers,
    data: {
      certification_id: fixture.certification_id,
      category_id: fixture.category_id,
      practice_exam_id: fixture.practice_exam_id,
      question_count: fixture.question_count,
    },
  });
  expect(response.status(), "create a real published exam attempt").toBe(201);
  const attempt = (await response.json()) as ExamCreatedResponse;
  expect(attempt.questions).toHaveLength(fixture.question_count);
  return attempt;
}

function paths(attempt: ExamCreatedResponse) {
  const pagePath = `/exams/${attempt.attempt_id}`;
  const api = `/api/v1${pagePath}`;
  return {
    page: pagePath,
    api,
    results: `${pagePath}/results`,
    review: `${pagePath}/review`,
    reviewApi: `${api}/review`,
  };
}

function questionsInOrder(attempt: ExamCreatedResponse) {
  return [...attempt.questions].sort((a, b) => a.position - b.position);
}

function optionAt(question: ExamQuestion, position: number) {
  const option = question.options.find((item) => item.position === position);
  if (!option) throw new Error(`Fixture question ${question.position} lacks option ${position}`);
  return option.id;
}

async function submitAnswer(
  page: Page,
  attempt: ExamCreatedResponse,
  question: ExamQuestion,
  headers: AuthHeaders,
  data: { selected_option_ids: string[] } | { text_response: string },
) {
  const response = await page.request.post(
    `${paths(attempt).api}/responses/${question.id}/submit`,
    { headers, data },
  );
  expect(response.ok(), `submit fixture answer ${question.position}`).toBe(true);
}

async function finishByApi(page: Page, attempt: ExamCreatedResponse, headers: AuthHeaders) {
  // The final submission API supports unanswered questions. The existing
  // live-exam UI's finish eligibility is outside JHEP-37's scope.
  const response = await page.request.post(`${paths(attempt).api}/submit`, { headers });
  expect(response.ok(), "complete the fixture attempt").toBe(true);
  expect(await response.json()).toMatchObject({ attempt_id: attempt.attempt_id, status: "submitted" });
}

async function readReview(page: Page, attempt: ExamCreatedResponse, headers: AuthHeaders) {
  const response = await page.request.get(paths(attempt).reviewApi, { headers });
  expect(response.status(), "read completed review from the real backend").toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const review = (await response.json()) as CompletedExamReview;
  expect(review.attempt_id).toBe(attempt.attempt_id);
  expect(review.status).toBe("submitted");
  expect(review.question_count).toBe(attempt.question_count);
  expect(review.questions.map((question) => question.question_version_id)).toEqual(
    questionsInOrder(attempt).map((question) => question.id),
  );
  expect(review.questions.map((question) => question.position)).toEqual(
    questionsInOrder(attempt).map((question) => question.position),
  );
  // Enforce an allowlist, not just a few forbidden field names.
  expect(Object.keys(review).sort()).toEqual(["attempt_id", "question_count", "questions", "status"]);
  for (const question of review.questions) {
    expect(Object.keys(question).sort()).toEqual(["position", "preview", "question_version_id", "status"]);
    expect(question.preview.trim()).not.toBe("");
    expect([...question.preview].length).toBeLessThanOrEqual(160);
  }
  return review;
}

async function snapshot(page: Page, attempt: ExamCreatedResponse, headers: AuthHeaders) {
  const [saved, results] = await Promise.all([
    page.request.get(paths(attempt).api, { headers }),
    page.request.get(`${paths(attempt).api}/results`, { headers }),
  ]);
  expect(saved.ok()).toBe(true);
  expect(results.ok()).toBe(true);
  return { attempt: await saved.json(), results: await results.json() };
}

function trackExamWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/v1\/exams(?:\/|$)/.test(pathname) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${pathname}`);
    }
  });
  return writes;
}

function questionList(page: Page) {
  return page.getByRole("list", { name: "Completed exam questions", exact: true });
}

function backToResults(page: Page) {
  return page.getByRole("link", { name: "Back to Results", exact: true });
}

function reviewLink(page: Page) {
  return page.getByRole("link", { name: "Review Answers", exact: true });
}

// Next.js also renders a route-announcer alert. Match the actual message
// rather than a positional alert or the framework's internal DOM id.
async function expectAlert(page: Page, message: string) {
  const alert = page.getByRole("alert").filter({ hasText: message });
  await expect(alert).toHaveText(message);
  await expect(alert).toBeVisible();
}

async function expectReview(page: Page, review: CompletedExamReview) {
  await expect(page.getByRole("heading", { level: 1, name: "Review answers", exact: true })).toBeVisible();
  const list = questionList(page);
  await expect(list.getByRole("listitem")).toHaveCount(review.questions.length);
  await expect(list.getByRole("heading", { level: 3 })).toHaveText(
    review.questions.map((question) => `Question ${question.position}`),
  );
  for (const question of review.questions) {
    const item = list.getByRole("listitem").nth(question.position - 1);
    await expect(item).toHaveAttribute("value", String(question.position));
    await expect(item.getByText(question.preview, { exact: true })).toBeVisible();
    await expect(item.getByText(labels[question.status], { exact: true })).toBeVisible();
  }
  await expect(page.getByText(`Showing ${review.questions.length} of ${review.questions.length} questions`, { exact: true })).toBeVisible();
  await expect(list.getByRole("radio")).toHaveCount(0);
  await expect(list.getByRole("checkbox")).toHaveCount(0);
  await expect(list.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /submit answer|finish exam/i })).toHaveCount(0);
  await expect(list.getByText(/Fixture explanation|REVIEW-FIXTURE-KEY|REVIEW-FIXTURE-EXPLANATION|Your response:|Feedback:/)).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  }), { message: "document must not scroll horizontally" }).toBeLessThanOrEqual(1);
}

async function enterReview(page: Page, attempt: ExamCreatedResponse) {
  await expect(reviewLink(page)).toHaveAttribute("href", paths(attempt).review);
  await reviewLink(page).focus();
  await expect(reviewLink(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${paths(attempt).review}/?$`));
}

// Keep one worker (repository config) and use fresh fixtures. Do not use
// arbitrary timeouts/sleeps, demo-account passwords, or production databases.
test.describe("JHEP-37 completed exam question review", () => {
  const errors = new WeakMap<Page, string[]>();

  test.beforeEach(({ page }) => {
    test.setTimeout(180_000);
    const messages: string[] = [];
    errors.set(page, messages);
    page.on("pageerror", (error) => messages.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i.test(message.text())) {
        messages.push(message.text());
      }
    });
  });

  test.afterEach(({ page }) => {
    expect(errors.get(page) ?? [], "uncaught browser or React hydration errors").toEqual([]);
  });

  test("desktop: finish a real exam, enter review by keyboard, filter, refresh and return without writes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = seed("immediate");
    const headers = await login(page, fixture);
    const attempt = await createAttempt(page, fixture, headers);
    const ordered = questionsInOrder(attempt);
    await page.goto(paths(attempt).page);

    // Complete via the actual live-exam UI (all three answers submitted).
    for (const question of ordered) {
      if (question.position > 1) {
        await page.getByRole("navigation", { name: "Question navigation", exact: true })
          .getByRole("button", { name: `Question ${question.position}`, exact: true }).click();
      }
      await expect(page.locator("#question-heading")).toHaveText(question.question_text);
      const correct = question.position !== 2;
      await page.getByRole("radio").nth(correct ? 0 : 1).click();
      const [response] = await Promise.all([
        page.waitForResponse((response) =>
          new URL(response.url()).pathname === `${paths(attempt).api}/responses/${question.id}/submit` && response.request().method() === "POST"),
        page.getByRole("button", { name: "Submit answer", exact: true }).click(),
      ]);
      expect(response.ok()).toBe(true);
      await expect(page.getByText(correct ? "Correct answer." : "Incorrect answer.", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Finish Exam", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    await expect(page.getByRole("heading", { name: "Practice exam complete", exact: true })).toBeVisible();

    const review = await readReview(page, attempt, headers);
    expect(review.questions.map((question) => question.status)).toEqual(["correct", "incorrect", "correct"]);
    const before = await snapshot(page, attempt, headers);
    const writes = trackExamWrites(page);
    await enterReview(page, attempt);
    await expectReview(page, review);
    await expectNoHorizontalOverflow(page);

    const filter = page.getByLabel("Filter by status", { exact: true });
    await backToResults(page).focus();
    await page.keyboard.press("Tab");
    await expect(filter).toBeFocused();
    await filter.selectOption("incorrect");
    await expect(questionList(page).getByRole("heading", { level: 3 })).toHaveText(["Question 2"]);
    await filter.selectOption("pending_manual_grading");
    await expect(page.getByText("No questions match this status.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show all questions", exact: true }).click();
    await expect(filter).toHaveValue("all");
    await expectReview(page, review);

    await page.reload();
    await expectReview(page, review);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    await expect(reviewLink(page)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).review}/?$`));
    await expectReview(page, review);
    await backToResults(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    await expect(reviewLink(page)).toBeVisible();
    expect(await snapshot(page, attempt, headers)).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("mobile and tablet: 40 deferred questions preserve saved order, unanswered outcomes and responsive scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const fixture = seed("deferred");
    const headers = await login(page, fixture);
    const attempt = await createAttempt(page, fixture, headers);
    const ordered = questionsInOrder(attempt);
    expect(ordered).toHaveLength(40);
    await submitAnswer(page, attempt, ordered[0], headers, { selected_option_ids: [optionAt(ordered[0], 1)] });
    await submitAnswer(page, attempt, ordered[1], headers, { selected_option_ids: [optionAt(ordered[1], 2)] });
    await finishByApi(page, attempt, headers);
    const review = await readReview(page, attempt, headers);
    expect(review.questions.map((question) => question.status)).toEqual([
      "correct", "incorrect", ...Array<ReviewStatus>(38).fill("unanswered"),
    ]);
    const before = await snapshot(page, attempt, headers);
    const writes = trackExamWrites(page);
    await page.goto(paths(attempt).results);
    await expect(reviewLink(page)).toBeVisible();
    await reviewLink(page).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).review}/?$`));
    await expectReview(page, review);

    const filter = page.getByLabel("Filter by status", { exact: true });
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalOverflow(page);
      const filterBox = await filter.boundingBox();
      const backBox = await backToResults(page).boundingBox();
      expect(filterBox?.height ?? 0, `filter touch target at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(backBox?.height ?? 0, `back touch target at ${width}px`).toBeGreaterThanOrEqual(44);
      await expect(questionList(page).getByRole("listitem")).toHaveCount(40);
      await questionList(page).getByRole("heading", { name: "Question 40", exact: true }).scrollIntoViewIfNeeded();
      await expect(questionList(page).getByRole("heading", { name: "Question 40", exact: true })).toBeInViewport();
    }
    await page.setViewportSize({ width: 320, height: 720 });
    await filter.selectOption("unanswered");
    await expect(questionList(page).getByRole("listitem")).toHaveCount(38);
    await expect(questionList(page).getByRole("heading", { level: 3 }).first()).toHaveText("Question 3");
    await expect(questionList(page).getByRole("heading", { level: 3 }).last()).toHaveText("Question 40");
    await filter.selectOption("all");
    await page.reload();
    await expectReview(page, review);
    await expectNoHorizontalOverflow(page);
    await backToResults(page).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    expect(await snapshot(page, attempt, headers)).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("pending written grading remains reviewable and long previews stay within a 320px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const fixture = seed("mixed");
    const headers = await login(page, fixture);
    const attempt = await createAttempt(page, fixture, headers);
    const ordered = questionsInOrder(attempt);
    const written = ordered.find((question) => question.question_type === "short_answer");
    const choices = ordered.filter((question) => question.question_type === "multiple_choice");
    if (!written || choices.length !== 3) throw new Error("Mixed review fixture must contain one written and three choice questions");
    const privateResponse = "REVIEW-FIXTURE-PRIVATE-RESPONSE";
    await submitAnswer(page, attempt, written, headers, { text_response: privateResponse });
    await submitAnswer(page, attempt, choices[0], headers, { selected_option_ids: [optionAt(choices[0], 1)] });
    await submitAnswer(page, attempt, choices[1], headers, { selected_option_ids: [optionAt(choices[1], 2)] });
    await finishByApi(page, attempt, headers);

    const review = await readReview(page, attempt, headers);
    expect(JSON.stringify(review)).not.toContain(privateResponse);
    expect(review.questions.find((question) => question.question_version_id === written.id)).toMatchObject({
      position: written.position, status: "pending_manual_grading",
    });
    expect(review.questions.map((question) => question.status).sort()).toEqual(["correct", "incorrect", "pending_manual_grading", "unanswered"]);
    const writtenPreview = review.questions.find((question) => question.question_version_id === written.id)?.preview;
    if (!writtenPreview) throw new Error("Written question preview is missing");
    expect(writtenPreview.endsWith("…")).toBe(true);
    expect([...writtenPreview].length).toBe(160);
    const before = await snapshot(page, attempt, headers);
    expect(before.results as ExamResultsResponse).toMatchObject({ grading_complete: false, passed: null, pending_manual_grading_count: 1 });
    const writes = trackExamWrites(page);
    await page.goto(paths(attempt).results);
    await expect(page.getByRole("heading", { name: "Written responses awaiting review", exact: true })).toBeVisible();
    // Confirm the marker really exists in the owner's results before leaving.
    await expect(page.getByText(`Your response: ${privateResponse}`, { exact: true })).toBeVisible();
    await reviewLink(page).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).review}/?$`));
    await expectReview(page, review);
    await expectNoHorizontalOverflow(page);
    // Cache Components can retain the previous results page in a hidden
    // subtree. Assert both list privacy and absence from the visible page.
    await expect(questionList(page).getByText(privateResponse)).toHaveCount(0);
    await expect(page.getByText(privateResponse).filter({ visible: true })).toHaveCount(0);
    await page.getByLabel("Filter by status", { exact: true }).selectOption("pending_manual_grading");
    await expect(questionList(page).getByRole("heading", { level: 3 })).toHaveText([`Question ${written.position}`]);
    await expect(questionList(page).getByText("Pending Grading", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.reload();
    await expectReview(page, review);
    // A full reload removes the previous route's retained DOM. The marker
    // must now be absent from the entire page, not merely invisible.
    await expect(page.getByText(privateResponse)).toHaveCount(0);
    expect(await snapshot(page, attempt, headers)).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("security: unfinished, foreign, anonymous and unknown reviews cannot expose question content", async ({ page, browser }) => {
    const fixture = seed("immediate");
    const headers = await login(page, fixture);
    const attempt = await createAttempt(page, fixture, headers);
    const first = questionsInOrder(attempt)[0];
    const unfinished = await page.request.get(paths(attempt).reviewApi, { headers });
    expect(unfinished.status()).toBe(409);
    expect(await unfinished.text()).not.toContain(first.question_text);
    await page.goto(paths(attempt).review);
    await expectAlert(page, "Finish the practice exam before reviewing its answers.");
    await expect(questionList(page)).toHaveCount(0);
    await expect(backToResults(page)).toHaveAttribute("href", paths(attempt).results);
    await backToResults(page).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    await expectAlert(page, "Attempt has not been submitted");
    await expect(reviewLink(page)).toHaveCount(0);

    await finishByApi(page, attempt, headers);
    const review = await readReview(page, attempt, headers);
    const before = await snapshot(page, attempt, headers);
    const anonymous = await page.request.get(paths(attempt).reviewApi);
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.text()).not.toContain(first.question_text);

    // A truly separate authenticated browser context; never overwrite the
    // owner's session. The fixture creates a distinct verified learner.
    const stranger = seed("immediate");
    const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const other = await otherContext.newPage();
      await other.goto(paths(attempt).review);
      await expect(other).toHaveURL(/\/login(?:\?|$)/);
      await expect(questionList(other)).toHaveCount(0);
      const otherHeaders = await login(other, stranger);
      const denied = await other.request.get(paths(attempt).reviewApi, { headers: otherHeaders });
      const unknown = await other.request.get(`/api/v1/exams/${randomUUID()}/review`, { headers: otherHeaders });
      expect(denied.status()).toBe(404);
      expect(unknown.status()).toBe(404);
      expect(await denied.json()).toEqual(await unknown.json());
      expect(await denied.text()).not.toContain(first.question_text);
      await other.goto(paths(attempt).review);
      await expectAlert(other, "This exam review is unavailable.");
      await expect(questionList(other)).toHaveCount(0);
      await expect(other.getByText(first.question_text, { exact: true })).toHaveCount(0);
      await expect(backToResults(other)).toBeVisible();
      await expect(other.getByRole("button", { name: "Retry loading review", exact: true })).toHaveCount(0);
    } finally {
      await otherContext.close();
    }
    await page.goto(paths(attempt).review);
    await expectReview(page, review);
    expect(await snapshot(page, attempt, headers)).toEqual(before);
  });

  test("recoverable errors: loading, network failure, retry, empty response and mismatched attempt fail safely", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const fixture = seed("immediate");
    const headers = await login(page, fixture);
    const attempt = await createAttempt(page, fixture, headers);
    await finishByApi(page, attempt, headers);
    const review = await readReview(page, attempt, headers);
    const before = await snapshot(page, attempt, headers);
    const writes = trackExamWrites(page);
    const pattern = `**${paths(attempt).reviewApi}`;

    // Intercept only the review GET. Gate all initial requests (including
    // development Strict Mode replays) until the loading state is asserted.
    // Then fail them, and let the explicit retry hit the real API.
    type ReviewMode = "network-error" | "real" | "empty" | "foreign";
    const simulation: { mode: ReviewMode } = { mode: "network-error" };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const foreignId = randomUUID();
    await page.route(pattern, async (route) => {
      switch (simulation.mode) {
        case "network-error":
          await gate;
          await route.abort("failed");
          break;
        case "empty":
          await route.fulfill({ json: { ...review, questions: [] } });
          break;
        case "foreign":
          await route.fulfill({ json: { ...review, attempt_id: foreignId } });
          break;
        default:
          await route.continue();
      }
    });
    try {
      await page.goto(paths(attempt).review, { waitUntil: "domcontentloaded" });
      await expect(backToResults(page)).toBeVisible();
      await expect(page.getByText("Loading exam review...", { exact: true })).toBeVisible();
      await expect(questionList(page)).toHaveCount(0);
    } finally {
      release();
    }
    await expectAlert(page, "Unable to load exam review. Please try again.");
    simulation.mode = "real";
    await page.getByRole("button", { name: "Retry loading review", exact: true }).click();
    await expectReview(page, review);

    // A legitimate empty historical response is a non-error empty state.
    simulation.mode = "empty";
    await page.reload();
    await expect(page.getByRole("heading", { name: "No questions available", exact: true })).toBeVisible();
    await expect(questionList(page)).toHaveCount(0);
    await expect(backToResults(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Even an HTTP 200 containing a different attempt must not be rendered.
    simulation.mode = "foreign";
    await page.reload();
    await expectAlert(page, "Unable to load exam review. Please try again.");
    await expect(questionList(page)).toHaveCount(0);
    simulation.mode = "real";
    await page.getByRole("button", { name: "Retry loading review", exact: true }).click();
    await expectReview(page, review);
    await backToResults(page).click();
    await expect(page).toHaveURL(new RegExp(`${paths(attempt).results}/?$`));
    expect(await snapshot(page, attempt, headers)).toEqual(before);
    expect(writes).toEqual([]);
  });
});
