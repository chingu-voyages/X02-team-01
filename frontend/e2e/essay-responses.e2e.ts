import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { QuestionFeedback } from "../src/types/exam-api.types";
import {
  answerControls,
  createAttempt,
  essayField,
  expectCurrentQuestion,
  expectNoHorizontalOverflow,
  expectUsableAnswerControls,
  loginLearner,
  loginViaApi,
  navigateToQuestion,
  responsePath,
  startEssayAttempt,
  submitCurrent,
} from "./helpers/essay-fixtures";

const hydrationPattern = /hydration|hydrating|server.rendered HTML|Minified React error #(?:418|423|425)\b/i;
const runtimeErrors = new WeakMap<Page, string[]>();

// Scope validation/save errors to the named question region, and Finish
// errors to the answer-controls wrapper. Next.js has a separate role="alert"
// route announcer. Keep error-content, absence and hydration assertions intact.

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // Network errors are deliberately induced in failure-recovery tests. They
  // are not ignored as page exceptions; only console HTTP errors are allowed.
  page.on("console", (message) => {
    if (message.type() === "error" && hydrationPattern.test(message.text())) errors.push(message.text());
  });
});

test.afterEach(({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "uncaught browser / hydration errors").toEqual([]);
});

for (const mode of ["immediate", "deferred"] as const) {
  test(`${mode}: mixed exam, out-of-order Finish and real manual grading`, async ({ page }, testInfo) => {
    const flow = await startEssayAttempt(page, mode);
    const { fixture, attempt, readAttempt, readResults, fillAndSubmit } = flow;
    const essays = attempt.questions.filter((question) => question.question_type === "essay");
    // Randomization is real. Choose an essay that is NOT the final position.
    const finishOn = essays.find((question) => question.id !== attempt.questions.at(-1)?.id)!;
    const longText = `  First paragraph — café 😀.\n\nSecond paragraph preserves indentation.\n  ${"longword".repeat(60)}  `;
    for (const question of [...attempt.questions].reverse()) {
      if (question.id !== finishOn.id) await fillAndSubmit(question, longText);
    }
    await expect(page.getByRole("button", { name: "Finish Exam", exact: true })).toHaveCount(0);
    const reviewerToken = await loginViaApi(page, fixture.reviewer_email, fixture.reviewer_password);
    const reviewerHeaders = { Authorization: `Bearer ${reviewerToken}` };
    const queuePath = "/api/v1/admin/grading/pending?response_type=essay";
    const beforeQueue = await page.request.get(queuePath, { headers: reviewerHeaders });
    expect(beforeQueue.status()).toBe(200);
    const before = await beforeQueue.json() as { items: { attempt_id: string }[] };
    expect(before.items.filter((item) => item.attempt_id === attempt.attempt_id)).toHaveLength(0);

    await fillAndSubmit(finishOn, longText);
    const finish = answerControls(page).getByRole("button", { name: "Finish Exam", exact: true });
    await expect(finish).toBeFocused();
    await expect(page.getByRole("button", { name: "Finish Exam", exact: true })).toHaveCount(1);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "4 of 4 questions submitted");
    await expectUsableAnswerControls(page);
    await testInfo.attach("all-answers-submitted", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const saved = await readAttempt();
    for (const essay of essays) {
      expect(saved.questions.find((question) => question.id === essay.id)?.response?.text_response).toBe(longText);
    }
    await finish.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
    // Finishing submits written responses for review; it does not grade them.
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Written responses awaiting review",
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Practice exam complete",
      exact: true,
    })).toHaveCount(0);
    const results = await readResults();
    expect(results.grading_complete).toBe(false);
    expect(results.passed).toBeNull();
    expect(results.pending_manual_grading_count).toBe(3); // two essays + one short answer
    for (const essay of essays) {
      const result = results.questions?.find((question) => question.question_version_id === essay.id);
      expect(result?.status).toBe("pending_manual_grading");
      expect(result?.learner_response).toBe(longText);
      const row = page.getByRole("region", { name: "Question breakdown", exact: true })
        .getByRole("listitem").filter({ has: page.getByText(essay.question_text, { exact: true }) });
      await expect(row.getByText("Awaiting manual review", { exact: true })).toBeVisible();
      await expect(row.getByText(/^Score:/)).toHaveCount(0);
      const renderedResponse = row.locator("p").filter({ hasText: /^Your response:/ });
      await expect(renderedResponse).toHaveCSS("white-space", "pre-wrap");
      await expect(renderedResponse).toHaveCSS("overflow-wrap", "anywhere");
    }
    await expectNoHorizontalOverflow(page);
    await testInfo.attach("pending-results", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    const queue = await page.request.get(queuePath, { headers: reviewerHeaders });
    expect(queue.status()).toBe(200);
    const queued = await queue.json() as { items: { attempt_id: string }[] };
    expect(queued.items.filter((item) => item.attempt_id === attempt.attempt_id)).toHaveLength(2);
    const grade = await page.request.post(`/api/v1/admin/grading/responses/${attempt.attempt_id}/${finishOn.id}/grade`, {
      headers: reviewerHeaders, data: { score: 1, feedback: "Clear explanation. Add more detail about recovery." },
    });
    expect(grade.status()).toBe(200);
    const updated = await readResults();
    expect(updated.questions?.find((question) => question.question_version_id === finishOn.id)).toMatchObject({
      status: "graded", outcome: "manually_graded", points_earned: 1, max_points: 2,
      learner_response: longText,
    });
    await page.reload();
    await expect(page.getByText("Feedback: Clear explanation. Add more detail about recovery.", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("keyboard entry, draft navigation and flags remain independent", async ({ page }, testInfo) => {
  const { attempt, readAttempt } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question, index) => question.question_type === "essay" && index < attempt.questions.length - 1)!;
  const index = attempt.questions.findIndex((question) => question.id === essay.id);
  await navigateToQuestion(page, attempt, essay, true);
  await expect(essayField(page)).toHaveAccessibleDescription(/Submitting locks this answer/);
  await expect(essayField(page)).toHaveAccessibleDescription(/submit before refreshing or leaving/);
  await expect(answerControls(page).getByRole("button", { name: "Submit answer", exact: true })).toBeDisabled();
  await essayField(page).fill("First paragraph.");
  await essayField(page).press("Enter");
  await essayField(page).press("Enter");
  await essayField(page).pressSequentially("Second paragraph.");
  const draft = "First paragraph.\n\nSecond paragraph.";
  await expect(essayField(page)).toHaveValue(draft);
  // Enter remains text entry, not implicit submission.
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response).toBeFalsy();
  await expect(essayField(page)).toHaveCSS("font-size", "16px");
  await essayField(page).press("Tab");
  await expect(answerControls(page).getByRole("button", { name: index === 0 ? "Next without submitting" : "Previous", exact: true })).toBeFocused();
  const flag = page.getByRole("button", { name: "Flag for Review", exact: true });
  await flag.focus();
  await flag.press("Enter");
  await expect(page.getByRole("button", { name: "Flagged for Review", exact: true })).toHaveAttribute("aria-pressed", "true");
  await answerControls(page).getByRole("button", { name: "Next without submitting", exact: true }).press("Enter");
  await expectCurrentQuestion(page, attempt.questions[index + 1]);
  await answerControls(page).getByRole("button", { name: "Previous", exact: true }).press("Enter");
  await expect(essayField(page)).toHaveValue(draft);
  await expect(page.getByRole("heading", { level: 1, name: `Question ${index + 1} of 4`, exact: true })).toBeFocused();

  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const trigger = page.getByRole("button", { name: /^Question navigation ·/i });
    await trigger.focus();
    await trigger.press("Enter");
    const panel = page.getByRole("region", { name: "Mobile question navigation", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /^Question 1(?:,|$)/ }).press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  const other = attempt.questions.find((question) => question.id !== essay.id)!;
  await navigateToQuestion(page, attempt, other, true);
  await navigateToQuestion(page, attempt, essay, true);
  await expect(essayField(page)).toHaveValue(draft);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "0 of 4 questions submitted");
  const saved = (await readAttempt()).questions.find((question) => question.id === essay.id);
  expect(saved?.flagged_for_review).toBe(true);
  expect(saved?.response).toBeFalsy();
  await expectUsableAnswerControls(page);
  await testInfo.attach("essay-draft", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("blank, oversized and Unicode boundary values are validated without truncation", async ({ page }) => {
  const { attempt, headers, readAttempt } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question) => question.question_type === "essay")!;
  await navigateToQuestion(page, attempt, essay);
  const submit = answerControls(page).getByRole("button", { name: "Submit answer", exact: true });
  await essayField(page).fill(" \n\t ");
  await expect(submit).toBeDisabled();
  const blank = await page.request.post(responsePath(attempt, essay), { headers, data: { text_response: " \n\t " } });
  expect(blank.status()).toBe(422);
  const tooLong = "😀".repeat(10_001);
  await essayField(page).fill(tooLong);
  await expect(essayField(page)).toHaveValue(tooLong);
  await expect(page.getByText("10,001 / 10,000 characters", { exact: true })).toBeVisible();
  await expect(essayField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("region", { name: essay.question_text, exact: true }).getByRole("alert")).toContainText("your text has not been cut off");
  const rejected = await page.request.post(responsePath(attempt, essay), { headers, data: { text_response: tooLong } });
  expect(rejected.status()).toBe(422);
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response).toBeFalsy();
  const boundary = "😀".repeat(10_000);
  await essayField(page).fill(boundary);
  await expect(page.getByText("10,000 / 10,000 characters", { exact: true })).toBeVisible();
  await expect(essayField(page)).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("region", { name: essay.question_text, exact: true }).getByRole("alert")).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await submitCurrent(page, attempt, essay);
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response?.text_response).toBe(boundary);
  await expectNoHorizontalOverflow(page);
});

test("a failed save preserves editable text and another question's draft", async ({ page }) => {
  const { attempt, readAttempt } = await startEssayAttempt(page);
  const [essay, other] = attempt.questions.filter((question) => question.question_type === "essay");
  await navigateToQuestion(page, attempt, other);
  await essayField(page).fill("Other question draft");
  await navigateToQuestion(page, attempt, essay);
  await essayField(page).fill("  First draft\n\nNever discard me.  ");
  const url = `**${responsePath(attempt, essay)}`;
  await page.route(url, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Injected save failure" }) }), { times: 1 });
  await answerControls(page).getByRole("button", { name: "Submit answer", exact: true }).click();
  await expect(page.getByRole("region", { name: essay.question_text, exact: true }).getByRole("alert")).toContainText("Your response is still here");
  await expect(essayField(page)).not.toHaveAttribute("readonly", "");
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response).toBeFalsy();
  await essayField(page).fill("  Edited after failure.\n\nSafe to retry.  ");
  await navigateToQuestion(page, attempt, other);
  await expect(essayField(page)).toHaveValue("Other question draft");
  await navigateToQuestion(page, attempt, essay);
  await expect(essayField(page)).toHaveValue("  Edited after failure.\n\nSafe to retry.  ");
  await submitCurrent(page, attempt, essay);
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response?.text_response).toBe("  Edited after failure.\n\nSafe to retry.  ");
});

test("lost success confirmation can be retried without rewriting the saved essay", async ({ page }) => {
  const { attempt, readAttempt } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question) => question.question_type === "essay")!;
  await navigateToQuestion(page, attempt, essay);
  const text = "  Stored even if the success response is lost.\n\nRetry exactly this.  ";
  await essayField(page).fill(text);
  let stored: QuestionFeedback | undefined;
  await page.route(`**${responsePath(attempt, essay)}`, async (route) => {
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(200);
    stored = await response.json() as QuestionFeedback;
    await route.abort("failed");
  }, { times: 1 });
  await answerControls(page).getByRole("button", { name: "Submit answer", exact: true }).click();
  await expect(page.getByRole("region", { name: essay.question_text, exact: true }).getByRole("alert")).toContainText("Your response is still here");
  await expect(essayField(page)).toHaveValue(text);
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response?.is_submitted).toBe(true);
  const retried = await submitCurrent(page, attempt, essay);
  expect(stored?.question_submitted_at).toBeTruthy();
  expect(retried.question_submitted_at).toBe(stored?.question_submitted_at);
  const rows = (await readAttempt()).questions.filter((question) => question.id === essay.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].response?.text_response).toBe(text);
});

test("pending submission blocks duplicate clicks, edits and navigation", async ({ page }) => {
  const { attempt, readAttempt } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question, index) => question.question_type === "essay" && index < 3)!;
  await navigateToQuestion(page, attempt, essay);
  await essayField(page).fill("One request only");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const url = `**${responsePath(attempt, essay)}`;
  const handler = async (route: Route) => { requests += 1; await gate; await route.continue(); };
  await page.route(url, handler);
  try {
    await answerControls(page).getByRole("button", { name: "Submit answer", exact: true }).dblclick();
    await expect(page.getByRole("status").filter({ hasText: "Submitting your answer…" })).toBeVisible();
    await expect(essayField(page)).toHaveAttribute("readonly", "");
    await expect(essayField(page)).toHaveAttribute("aria-busy", "true");
    await expect(answerControls(page).getByRole("button", { name: "Submitting...", exact: true })).toBeDisabled();
    await expect(answerControls(page).getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
    await expect(answerControls(page).getByRole("button", { name: "Next without submitting", exact: true })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response).toBeFalsy();
    await expectNoHorizontalOverflow(page);
  } finally {
    release();
  }
  await expect(page.getByRole("status").filter({ hasText: "Answer submitted. Pending feedback." })).toBeVisible();
  await expect(answerControls(page).getByRole("button", { name: "Next Question", exact: true })).toBeFocused();
  await page.unroute(url, handler);
  expect(requests).toBe(1);
});

test("a real second-tab conflict preserves both the saved response and unsent drafts", async ({ page, context }) => {
  const { fixture, attempt, readAttempt } = await startEssayAttempt(page);
  const [essay, other] = attempt.questions.filter((question) => question.question_type === "essay");
  const unsent = "  Local draft that must remain copyable.\n\nKeep this too.  ";
  await navigateToQuestion(page, attempt, other);
  await essayField(page).fill("Draft on another question");
  await navigateToQuestion(page, attempt, essay);
  await essayField(page).fill(unsent);
  const second = await context.newPage();
  second.on("pageerror", (error) => runtimeErrors.get(page)?.push(`Second tab: ${error.message}`));
  try {
    await loginLearner(second, fixture);
    await second.goto(`/exams/${attempt.attempt_id}`);
    await expectCurrentQuestion(second, attempt.questions[0]);
    await navigateToQuestion(second, attempt, essay);
    await essayField(second).fill("Saved from the other tab");
    await submitCurrent(second, attempt, essay);
    await answerControls(page).getByRole("button", { name: "Submit answer", exact: true }).click();
    await expect(essayField(page)).toHaveValue("Saved from the other tab");
    await expect(essayField(page)).toHaveAttribute("readonly", "");
    await page.getByText("Your unsent draft (not submitted)", { exact: true }).click();
    await expect(page.locator("details pre")).toHaveText(unsent);
    expect(await page.locator("details pre").textContent()).toBe(unsent);
    await expectNoHorizontalOverflow(page);
    await navigateToQuestion(page, attempt, other);
    await expect(essayField(page)).toHaveValue("Draft on another question");
    expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response?.text_response).toBe("Saved from the other tab");
  } finally {
    await second.close();
  }
});

test("submitted markup-looking text survives reload as plain, read-only text", async ({ page }) => {
  const { attempt, headers } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question) => question.question_type === "essay")!;
  const text = '<script>window.__essayExecuted = true</script>\n\n<img src=x onerror="window.__essayExecuted=true">  ';
  await navigateToQuestion(page, attempt, essay);
  await essayField(page).fill(text);
  await submitCurrent(page, attempt, essay);
  await page.reload();
  await expectCurrentQuestion(page, attempt.questions[0]);
  await navigateToQuestion(page, attempt, essay);
  await expect(essayField(page)).toHaveValue(text);
  await expect(essayField(page)).toHaveAttribute("readonly", "");
  await expect(essayField(page)).toBeEnabled();
  await essayField(page).focus();
  await expect(essayField(page)).toBeFocused();
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, "__essayExecuted"))).toBe(false);
  const overwrite = await page.request.post(responsePath(attempt, essay), { headers, data: { text_response: "Overwrite" } });
  expect(overwrite.status()).toBe(409);
  await expect(page.getByText("Incorrect answer.", { exact: true })).toHaveCount(0);
});

test("the real API isolates learners, attempts and assigned question versions", async ({ page }) => {
  const { fixture, attempt, headers, readAttempt } = await startEssayAttempt(page);
  const essay = attempt.questions.find((question) => question.question_type === "essay")!;
  const otherToken = await loginViaApi(page, fixture.other_email, fixture.other_password);
  const otherHeaders = { Authorization: `Bearer ${otherToken}` };
  const foreignRead = await page.request.get(`/api/v1/exams/${attempt.attempt_id}`, { headers: otherHeaders });
  expect(foreignRead.status()).toBe(404);
  const foreignWrite = await page.request.post(responsePath(attempt, essay), { headers: otherHeaders, data: { text_response: "Not mine" } });
  expect(foreignWrite.status()).toBe(404);
  const wrongVersion = await page.request.post(`/api/v1/exams/${attempt.attempt_id}/responses/${randomUUID()}/submit`, { headers, data: { text_response: "Unassigned" } });
  expect(wrongVersion.status()).toBe(404);
  const otherAttempt = await createAttempt(page, fixture, otherToken);
  const sharedVersion = otherAttempt.questions.find((question) => question.id === essay.id)!;
  expect(sharedVersion).toBeTruthy();
  const otherSaved = await page.request.post(responsePath(otherAttempt, sharedVersion), { headers: otherHeaders, data: { text_response: "Other learner's own answer" } });
  expect(otherSaved.status()).toBe(200);
  expect((await readAttempt()).questions.find((question) => question.id === essay.id)?.response).toBeFalsy();
  const deniedQueue = await page.request.get("/api/v1/admin/grading/pending?response_type=essay", { headers });
  expect(deniedQueue.status()).toBe(403);
});

test("lost Finish confirmation recovers on retry and completed attempts stay read-only", async ({ page }) => {
  const { attempt, headers, readAttempt, readResults, fillAndSubmit } = await startEssayAttempt(page);
  for (const question of attempt.questions) await fillAndSubmit(question);
  const finishPath = `/api/v1/exams/${attempt.attempt_id}/submit`;
  await page.route(`**${finishPath}`, async (route) => {
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(200);
    await route.abort("failed");
  }, { times: 1 });
  await answerControls(page).getByRole("button", { name: "Finish Exam", exact: true }).click();
  await expect(answerControls(page).locator("..").getByRole("alert")).toBeVisible();
  expect((await readAttempt()).status).toBe("submitted");
  const before = await readResults();
  await answerControls(page).getByRole("button", { name: "Finish Exam", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
  expect((await readResults()).questions).toEqual(before.questions);
  await page.goto(`/exams/${attempt.attempt_id}`);
  await expect(page.getByText("This exam has been submitted. Answers are read-only.", { exact: true })).toBeVisible();
  const essay = attempt.questions.find((question) => question.question_type === "essay")!;
  await navigateToQuestion(page, attempt, essay);
  await expect(essayField(page)).toHaveAttribute("readonly", "");
  await expect(page.getByRole("status").filter({ hasText: "Answer submitted. View results for feedback." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit answer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish Exam", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Flag for Review", exact: true })).toBeDisabled();
  const closedWrite = await page.request.post(responsePath(attempt, essay), { headers, data: { text_response: "After finish" } });
  expect(closedWrite.status()).toBe(409);
  await page.getByRole("button", { name: "View results", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${attempt.attempt_id}/results$`));
});
