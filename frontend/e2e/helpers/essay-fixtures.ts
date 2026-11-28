import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type {
  ExamAttempt,
  ExamCreatedResponse,
  ExamQuestion,
  ExamResultsResponse,
  QuestionFeedback,
} from "../../src/types/exam-api.types";

export type FeedbackMode = "immediate" | "deferred";
export type EssayFixture = {
  run_id: string;
  mode: FeedbackMode;
  email: string;
  password: string;
  reviewer_email: string;
  reviewer_password: string;
  other_email: string;
  other_password: string;
  certification_id: string;
  category_id: string;
  practice_exam_id: string;
  exam_name: string;
  question_count: number;
  questions: {
    question_id: string;
    version_id: string;
    question_type: ExamQuestion["question_type"];
    correct_option_id: string | null;
  }[];
};

export function seedEssayFixture(mode: FeedbackMode): EssayFixture {
  const backend = path.resolve(process.cwd(), "../backend");
  const python = path.join(backend, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  const result = spawnSync(python, ["-m", "scripts.seed_essay_e2e", "--confirm-local", "--mode", mode], {
    cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to seed JHEP-120. Confirm local PostgreSQL, the backend .venv and alembic upgrade head. ${result.error?.message ?? result.stderr}`);
  }
  const data = JSON.parse(result.stdout) as EssayFixture;
  if (!data.run_id || !data.email || !data.password || data.question_count !== 4 || data.questions?.length !== 4) {
    throw new Error("Unexpected essay fixture output");
  }
  return data;
}

export async function loginLearner(page: Page, fixture: EssayFixture): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/?$/);
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("The real login did not establish a learner session");
  return token;
}

export async function loginViaApi(page: Page, email: string, password: string): Promise<string> {
  const response = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(response.status(), "fixture account login").toBe(200);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Fixture login did not return an access token");
  return data.access_token;
}

export async function createAttempt(page: Page, fixture: EssayFixture, token: string) {
  const response = await page.request.post("/api/v1/exams", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      certification_id: fixture.certification_id, category_id: fixture.category_id,
      practice_exam_id: fixture.practice_exam_id, question_count: fixture.question_count,
    },
  });
  expect(response.status(), "start the real published exam").toBe(201);
  const attempt = await response.json() as ExamCreatedResponse;
  expect(attempt.questions).toHaveLength(4);
  expect(attempt.questions.filter((question) => question.question_type === "essay")).toHaveLength(2);
  expect(JSON.stringify(attempt)).not.toContain("PRIVATE_JHEP120_KEY");
  return attempt;
}

export function answerControls(page: Page) {
  return page.getByRole("group", { name: "Answer and navigation controls", exact: true });
}

export function essayField(page: Page) {
  return page.getByRole("textbox", { name: "Your essay response", exact: true });
}

export function responsePath(attempt: ExamCreatedResponse, question: ExamQuestion) {
  return `/api/v1/exams/${attempt.attempt_id}/responses/${question.id}/submit`;
}

export async function expectCurrentQuestion(page: Page, question: ExamQuestion) {
  await expect(page.locator("#question-heading")).toHaveText(question.question_text);
}

export async function navigateToQuestion(page: Page, attempt: ExamCreatedResponse, question: ExamQuestion, keyboard = false) {
  const index = attempt.questions.findIndex((item) => item.id === question.id);
  if (index < 0) throw new Error("Question does not belong to the current fixture attempt");
  const trigger = page.getByRole("button", { name: /^Question navigation ·/i });
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  if (mobile) {
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute("aria-expanded") !== "true") {
      if (keyboard) { await trigger.focus(); await trigger.press("Enter"); }
      else await trigger.click();
    }
  }
  const container = mobile
    ? page.getByRole("region", { name: "Mobile question navigation", exact: true })
    : page.getByRole("complementary", { name: "Question navigation sidebar", exact: true });
  const tile = container.getByRole("button", { name: new RegExp(`^Question ${index + 1}(?:,|$)`) });
  if (keyboard) { await tile.focus(); await tile.press("Enter"); }
  else await tile.click();
  await expectCurrentQuestion(page, question);
  if (mobile) await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

export async function submitCurrent(page: Page, attempt: ExamCreatedResponse, question: ExamQuestion) {
  const requestPath = responsePath(attempt, question);
  const [response] = await Promise.all([
    page.waitForResponse((item) => new URL(item.url()).pathname === requestPath && item.request().method() === "POST"),
    answerControls(page).getByRole("button", { name: "Submit answer", exact: true }).click(),
  ]);
  expect(response.status(), "persist answer through the real backend").toBe(200);
  const feedback = await response.json() as QuestionFeedback;
  expect(feedback.question_version_id).toBe(question.id);
  expect(feedback.is_submitted).toBe(true);
  if (question.question_type === "essay") {
    await expect(essayField(page)).toHaveAttribute("readonly", "");
    await expect(page.getByRole("status").filter({ hasText: "Answer submitted. Pending feedback." })).toBeVisible();
    expect(feedback.is_correct ?? null).toBeNull();
    expect(feedback.feedback_released).toBe(false);
    expect(feedback.explanation ?? null).toBeNull();
  } else if (question.question_type === "short_answer") {
    await expect(page.getByRole("textbox", { name: "Your answer", exact: true })).toBeDisabled();
  } else {
    await expect(page.getByRole("radio").first()).toBeDisabled();
  }
  return feedback;
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ), { message: "The page must not require horizontal scrolling" }).toBeLessThanOrEqual(1);
}

export async function expectUsableAnswerControls(page: Page) {
  const buttons = answerControls(page).getByRole("button");
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box, "answer control has a rendered target").not.toBeNull();
    expect(box!.height, "answer/navigation targets remain at least 44 CSS pixels high").toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
}

export async function startEssayAttempt(page: Page, mode: FeedbackMode = "deferred") {
  const fixture = seedEssayFixture(mode);
  const token = await loginLearner(page, fixture);
  const headers = { Authorization: `Bearer ${token}` };
  const attempt = await createAttempt(page, fixture, token);
  await page.goto(`/exams/${attempt.attempt_id}`);
  await expectCurrentQuestion(page, attempt.questions[0]);

  async function readAttempt(): Promise<ExamAttempt> {
    const response = await page.request.get(`/api/v1/exams/${attempt.attempt_id}`, { headers });
    expect(response.status()).toBe(200);
    return await response.json() as ExamAttempt;
  }
  async function readResults(): Promise<ExamResultsResponse> {
    const response = await page.request.get(`/api/v1/exams/${attempt.attempt_id}/results`, { headers });
    expect(response.status()).toBe(200);
    return await response.json() as ExamResultsResponse;
  }
  async function fillAndSubmit(question: ExamQuestion, text = "  Retain the learner's work.\n\nExplain the next action.  ") {
    await navigateToQuestion(page, attempt, question);
    if (question.question_type === "essay") await essayField(page).fill(text);
    else if (question.question_type === "short_answer") await page.getByRole("textbox", { name: "Your answer", exact: true }).fill("Retains work");
    else {
      const answer = page.getByRole("radio", {
        name: "Keep the response and offer retry", exact: true,
      });
      // Fail at the missing accessible name, not after the full test timeout.
      await expect(answer, "the visible answer text labels its radio control").toBeVisible();
      await answer.check();
      await expect(answer).toBeChecked();
    }
    return await submitCurrent(page, attempt, question);
  }
  return { fixture, token, headers, attempt, readAttempt, readResults, fillAndSubmit };
}
