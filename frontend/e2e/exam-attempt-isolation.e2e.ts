import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  ExamAttempt,
  ExamCreatedResponse,
  ExamResultsResponse,
  QuestionFeedback,
} from "../src/types/exam-api.types";

type PublishedExamFixture = { id: string; name: string };
type IsolationFixture = {
  email: string;
  password: string;
  certification_id: string;
  category_id: string;
  question_count: number;
  exams: [PublishedExamFixture, PublishedExamFixture];
};
type Headers = { Authorization: string };

function createFixture(): IsolationFixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const result = spawnSync(
    path.join(backend, ".venv/bin/python"),
    ["-m", "scripts.seed_attempt_isolation_e2e", "--confirm-local"],
    { cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to seed JHEP-203 fixtures. ${result.error?.message ?? result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as IsolationFixture;
}

async function login(page: Page, fixture: IsolationFixture): Promise<Headers> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("Login did not establish a learner session");
  return { Authorization: `Bearer ${token}` };
}

async function selectAndStart(
  page: Page,
  fixture: IsolationFixture,
  exam: PublishedExamFixture,
) {
  await page.goto("/categories");
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/exams" &&
      response.request().method() === "POST",
    ),
    page.getByRole("button", { name: `Start exam — ${exam.name}`, exact: true }).click(),
  ]);
  expect(response.request().postDataJSON()).toEqual({
    practice_exam_id: exam.id,
    certification_id: fixture.certification_id,
    category_id: fixture.category_id,
    question_count: fixture.question_count,
  });
  return response;
}

async function startNew(page: Page, fixture: IsolationFixture, exam: PublishedExamFixture) {
  const response = await selectAndStart(page, fixture, exam);
  expect(response.status(), `start ${exam.name}`).toBe(201);
  const attempt = (await response.json()) as ExamCreatedResponse;
  expect(attempt.questions).toHaveLength(fixture.question_count);
  await expectQuestion(page, attempt, 1);
  return attempt;
}

async function resume(
  page: Page,
  fixture: IsolationFixture,
  exam: PublishedExamFixture,
  attempt: ExamCreatedResponse,
  position: number,
) {
  const response = await selectAndStart(page, fixture, exam);
  expect(response.status(), `resume ${exam.name}`).toBe(409);
  expect(await response.json()).toMatchObject({
    detail: { code: "ATTEMPT_IN_PROGRESS", attempt_id: attempt.attempt_id },
  });
  const card = page.getByRole("article", { name: exam.name, exact: true });
  await expect(card.getByText("In progress", { exact: true })).toBeVisible();
  await expect(card.getByText(`You have an unfinished attempt for ${exam.name}.`, { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: `Start exam — ${exam.name}`, exact: true })).toHaveCount(0);
  // The sibling stays independently startable, even after a resume conflict.
  const sibling = fixture.exams.find((item) => item.id !== exam.id);
  if (!sibling) throw new Error("Missing sibling practice exam fixture");
  await expect(page.getByRole("button", { name: `Start exam — ${sibling.name}`, exact: true })).toBeEnabled();
  await card.getByRole("button", { name: `Continue exam — ${exam.name}`, exact: true }).click();
  await expectQuestion(page, attempt, position);
}

async function expectQuestion(page: Page, attempt: ExamCreatedResponse, number: number) {
  await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}$`));
  await expect(page.locator("#question-heading")).toHaveText(attempt.questions[number - 1].question_text);
}

async function navigate(page: Page, attempt: ExamCreatedResponse, number: number, flagged = false) {
  await page.getByRole("navigation", { name: "Question navigation", exact: true })
    .getByRole("button", { name: `Question ${number}${flagged ? ", flagged for review" : ""}`, exact: true })
    .click();
  await expectQuestion(page, attempt, number);
}

function radio(page: Page, correct: boolean) {
  // This fixture explicitly makes option A correct and option B incorrect.
  return page.getByRole("radio").nth(correct ? 0 : 1);
}

async function answer(page: Page, attempt: ExamCreatedResponse, number: number, correct: boolean) {
  await expectQuestion(page, attempt, number);
  await radio(page, correct).click();
  await expect(radio(page, correct)).toBeChecked();
  const endpoint = `/api/v1/exams/${attempt.attempt_id}/responses/${attempt.questions[number - 1].id}/submit`;
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "POST"),
    page.getByRole("button", { name: "Submit answer", exact: true }).click(),
  ]);
  expect(response.ok(), "submit answer").toBe(true);
  const feedback = (await response.json()) as QuestionFeedback;
  expect(feedback.is_submitted).toBe(true);
  expect(feedback.feedback_released).toBe(true);
  expect(feedback.is_correct).toBe(correct);
  await expect(radio(page, correct)).toBeDisabled();
  await expect(page.getByText(correct ? "Correct answer." : "Incorrect answer.", { exact: true })).toBeVisible();
}

async function flag(page: Page, attempt: ExamCreatedResponse, number: number) {
  const endpoint = `/api/v1/exams/${attempt.attempt_id}/questions/${attempt.questions[number - 1].id}/flag`;
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === "PUT"),
    page.getByRole("button", { name: "Flag for Review", exact: true }).click(),
  ]);
  expect(response.ok(), "save flag").toBe(true);
  expect(await response.json()).toMatchObject({
    attempt_id: attempt.attempt_id,
    question_version_id: attempt.questions[number - 1].id,
    flagged_for_review: true,
  });
  await expect(page.getByRole("button", { name: "Flagged for Review", exact: true })).toBeEnabled();
}

async function readAttempt(page: Page, headers: Headers, attempt: ExamCreatedResponse): Promise<ExamAttempt> {
  const response = await page.request.get(`/api/v1/exams/${attempt.attempt_id}`, { headers });
  expect(response.ok(), "read persisted attempt").toBe(true);
  return (await response.json()) as ExamAttempt;
}

async function expectSavedPosition(page: Page, headers: Headers, attempt: ExamCreatedResponse, position: number) {
  // Check the actual UI autosave, not a second manual progress PATCH.
  await expect(page.getByText("Progress saved", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readAttempt(page, headers, attempt)).current_position).toBe(position);
}

async function readResults(page: Page, headers: Headers, attempt: ExamCreatedResponse): Promise<ExamResultsResponse> {
  const response = await page.request.get(`/api/v1/exams/${attempt.attempt_id}/results`, { headers });
  expect(response.ok(), "read persisted results").toBe(true);
  return (await response.json()) as ExamResultsResponse;
}

async function finish(page: Page, headers: Headers, attempt: ExamCreatedResponse, correct: boolean) {
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/exams/${attempt.attempt_id}/submit` && response.request().method() === "POST"),
    page.getByRole("button", { name: "Finish Exam", exact: true }).click(),
  ]);
  expect(response.ok(), "finish exam").toBe(true);
  await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
  await expect(page.getByRole("heading", { name: "Practice exam complete" })).toBeVisible();
  expect(await readResults(page, headers, attempt)).toMatchObject({
    attempt_id: attempt.attempt_id,
    status: "submitted",
    correct_count: correct ? attempt.question_count : 0,
    incorrect_count: correct ? 0 : attempt.question_count,
    score_percent: correct ? 100 : 0,
    passed: correct,
  });
  // Once the exam is submitted, the resume endpoint may disclose grades.
  const completed = await readAttempt(page, headers, attempt);
  expect(completed.status).toBe("submitted");
  for (const question of completed.questions) {
    expect(question.response?.is_submitted).toBe(true);
    expect(question.response?.is_correct).toBe(correct);
  }
}

test("JHEP-203: identical published exam configurations keep independent attempts, answers, flags and results", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = createFixture();
  const [dataExam, programmingExam] = fixture.exams;
  const headers = await login(page, fixture);

  // Data is unfinished when the learner starts Programming from the catalog.
  const data = await startNew(page, fixture, dataExam);
  await answer(page, data, 1, true);
  await flag(page, data, 1);
  await navigate(page, data, 2);
  await expectSavedPosition(page, headers, data, 2);

  const programming = await startNew(page, fixture, programmingExam);
  expect(programming.attempt_id).not.toBe(data.attempt_id);
  expect(programming.certification_id).toBe(data.certification_id);
  // The same question versions deliberately occur in both attempts, possibly
  // in different orders. This proves state is scoped to the attempt, not
  // merely to the question ID.
  expect(programming.questions.map((q) => q.id).sort()).toEqual(data.questions.map((q) => q.id).sort());
  const matchingIndex = programming.questions.findIndex((q) => q.id === data.questions[0].id);
  expect(matchingIndex).toBeGreaterThanOrEqual(0);
  const matchingNumber = matchingIndex + 1;
  const untouched = await readAttempt(page, headers, programming);
  expect(untouched.current_position).toBe(1);
  expect(untouched.questions.every((q) => !q.response && !q.flagged_for_review)).toBe(true);

  await navigate(page, programming, matchingNumber);
  await expect(radio(page, true)).not.toBeChecked();
  await expect(radio(page, false)).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Flag for Review", exact: true })).toBeEnabled();
  await answer(page, programming, matchingNumber, false);
  await navigate(page, programming, 3);
  await expectSavedPosition(page, headers, programming, 3);

  // Recover Data by starting the same published exam again. The API must
  // return Data's attempt ID and the browser must use that exact ID.
  await resume(page, fixture, dataExam, data, 2);
  const dataSaved = await readAttempt(page, headers, data);
  expect(dataSaved.status).toBe("in_progress");
  expect(dataSaved.current_position).toBe(2);
  expect(dataSaved.questions[0].response).toMatchObject({
    is_submitted: true,
    selected_option_ids: [data.questions[0].options[0].id],
  });
  // The resume API deliberately hides correctness until final submission.
  // Immediate feedback was already verified by answer().
  expect(dataSaved.questions[0].response?.is_correct).toBeUndefined();
  expect(dataSaved.questions[0].flagged_for_review).toBe(true);
  expect(dataSaved.questions.slice(1).every((q) => !q.response && !q.flagged_for_review)).toBe(true);
  await navigate(page, data, 1, true);
  await expect(radio(page, true)).toBeChecked();
  await expect(radio(page, true)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Flagged for Review", exact: true })).toBeEnabled();

  for (const number of [2, 3]) {
    await navigate(page, data, number);
    await answer(page, data, number, true);
  }
  await finish(page, headers, data, true);

  // Completing Data does not submit Programming or overwrite its progress.
  const programmingSaved = await readAttempt(page, headers, programming);
  expect(programmingSaved.status).toBe("in_progress");
  expect(programmingSaved.current_position).toBe(3);
  expect(programmingSaved.questions[matchingIndex].response).toMatchObject({
    is_submitted: true,
    selected_option_ids: [programming.questions[matchingIndex].options[1].id],
  });
  expect(programmingSaved.questions[matchingIndex].response?.is_correct).toBeUndefined();
  expect(programmingSaved.questions.every((q) => !q.flagged_for_review)).toBe(true);
  expect(programmingSaved.questions.filter((q) => q.response?.is_submitted)).toHaveLength(1);

  // A completed exam can be retaken even while its sibling is unfinished.
  const retake = await startNew(page, fixture, dataExam);
  expect(retake.attempt_id).not.toBe(data.attempt_id);
  expect(retake.attempt_id).not.toBe(programming.attempt_id);
  expect((await readAttempt(page, headers, retake)).questions.every((q) => !q.response && !q.flagged_for_review)).toBe(true);

  await resume(page, fixture, programmingExam, programming, 3);
  await navigate(page, programming, matchingNumber);
  await expect(radio(page, false)).toBeChecked();
  await expect(radio(page, false)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Flag for Review", exact: true })).toBeEnabled();
  for (let number = 1; number <= fixture.question_count; number += 1) {
    if (number === matchingNumber) continue;
    await navigate(page, programming, number);
    await answer(page, programming, number, false);
  }
  await navigate(page, programming, fixture.question_count);
  await finish(page, headers, programming, false);
  expect(await readResults(page, headers, data)).toMatchObject({
    attempt_id: data.attempt_id,
    score_percent: 100,
    passed: true,
  });
  expect((await readAttempt(page, headers, retake)).status).toBe("in_progress");
});
