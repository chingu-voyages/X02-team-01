import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AdminCategory, AdminCertification } from "../src/types/admin-catalog-api.types";
import type { AdminQuestionDraftCreateRequest, AdminQuestionDraftCreated } from "../src/types/admin-question-api.types";

type Credentials = { email: string; password: string };
type Fixture = { administrator: Credentials & { totp_secret: string }; contributor: Credentials; certification_id: string; category_id: string };
type Scope = { certificationId: string; categoryId: string };
const backend = path.resolve(process.cwd(), "../backend");
const api = "/api/v1/admin";
const mobile = { width: 375, height: 812 };

function runPython(args: string[], input?: string): string {
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, { cwd: backend, env: process.env, encoding: "utf8", input, timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(`Local question bank fixture failed: ${result.error?.message ?? result.stderr}`);
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
async function signInAdmin(page: Page, fixture: Fixture) {
  await signIn(page, fixture.administrator);
  await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(runPython(["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"], fixture.administrator.totp_secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/?$/);
}
async function headers(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated session");
  return { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" };
}
async function createDraft(page: Page, scope: Scope, questionText: string) {
  const payload: AdminQuestionDraftCreateRequest = {
    certification_id: scope.certificationId, category_id: scope.categoryId, difficulty: "medium",
    question_text: questionText, question_type: "multiple_choice", allows_multiple_answers: false,
    explanation: "The first answer is correct for this local fixture.",
    options: [{ option_text: "Option A", is_correct: true }, { option_text: "Option B", is_correct: false }], expected_answer: null,
  rubric: null,
  max_points: null,
  criteria_markdown: null,
  };
  const response = await page.request.post(`${api}/questions`, { headers: await headers(page), data: payload });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as AdminQuestionDraftCreated).question_id;
}
async function transition(page: Page, id: string, action: string, data?: object) {
  const response = await page.request.post(`${api}/questions/${id}/${action}`, { headers: await headers(page), ...(data ? { data } : {}) });
  expect(response.status(), await response.text()).toBe(200);
}
async function openBank(page: Page) {
  await page.goto("/admin/questions");
  await expect(page.getByRole("heading", { name: "Question Bank", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Question Bank results", exact: true })).toBeVisible();
}
function table(page: Page) { return page.getByRole("table", { name: "Question Bank results", exact: true }); }
function shortId(id: string) { return `Q-${id.slice(0, 8).toUpperCase()}`; }
function rowFor(page: Page, id: string) {
  return table(page).getByRole("row").filter({ has: page.getByRole("link", { name: `View ${shortId(id)}`, exact: true }) });
}
async function searchFor(page: Page, text: string, id: string) {
  await page.getByRole("searchbox", { name: "Search questions" }).fill(text);
  await expect(rowFor(page, id)).toBeVisible();
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => table(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}
async function actionFits(row: Locator, name: string) {
  const action = row.getByRole("link", { name, exact: true });
  await expect(action).toBeVisible();
  // Check the entire button, not only whether some pixels are visible.
  await expect.poll(() => action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.closest("tr")?.getBoundingClientRect();
    return Boolean(parent && rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1 && rect.height >= 43);
  })).toBe(true);
}

test("JHEP-207: Question Bank actions remain accessible across viewport widths and filtered requests recover", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(mobile);
  const fixture = createFixture();
  await signInAdmin(page, fixture);
  const prefix = `QB-${randomUUID().slice(0, 12)}`;
  const certName = `Certification-${"LongName".repeat(12)}-${prefix}`;
  const categoryName = `Category-${"LongName".repeat(12)}-${prefix}`;
  const auth = await headers(page);
  const certResponse = await page.request.post(`${api}/certifications`, { headers: auth, data: { name: certName, code: prefix.toUpperCase(), passing_threshold_pct: 70, feedback_mode: "deferred" } });
  expect(certResponse.status(), await certResponse.text()).toBe(201);
  const certification = await certResponse.json() as AdminCertification;
  const catResponse = await page.request.post(`${api}/categories`, { headers: auth, data: { certification_id: certification.id, name: categoryName } });
  expect(catResponse.status(), await catResponse.text()).toBe(201);
  const category = await catResponse.json() as AdminCategory;
  const id = await createDraft(page, { certificationId: certification.id, categoryId: category.id }, `${prefix} ${"LongUnbrokenQuestionText".repeat(7)}?`);

  await openBank(page);
  await searchFor(page, prefix, id);
  await test.step("Long text and both actions stay inside the available content area", async () => {
    for (const width of [320, 375, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const row = rowFor(page, id);
      await expect(row.getByText(certName, { exact: true })).toBeVisible();
      await expect(row.getByText(categoryName, { exact: true })).toBeVisible();
      await expect(row.getByText("Draft", { exact: true })).toBeVisible();
      await expect.poll(() => row.evaluate((element) => getComputedStyle(element).display)).toBe(width >= 1280 ? "table-row" : "grid");
      await noOverflow(page);
      await actionFits(row, `View ${shortId(id)}`);
      await actionFits(row, `Edit ${shortId(id)}`);
    }
  });

  await test.step("Mobile filter disclosure retains the selected server filters", async () => {
    await page.setViewportSize(mobile);
    const toggle = page.getByRole("button", { name: /^Filters(?: \(\d+ active\))?$/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Certification", { exact: true })).toBeHidden();
    await toggle.click();
    await page.getByLabel("Certification", { exact: true }).selectOption(certification.id);
    await page.getByLabel("Category", { exact: true }).selectOption(category.id);
    await page.getByLabel("Workflow status", { exact: true }).selectOption("pending");
    await expect(rowFor(page, id)).toBeVisible();
    await expect(toggle).toHaveAccessibleName("Filters (3 active)");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await noOverflow(page);
    await expect(rowFor(page, id)).toBeVisible();
    await toggle.click();
    await expect(page.getByLabel("Certification", { exact: true })).toHaveValue(certification.id);
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(category.id);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByLabel("Certification", { exact: true })).toHaveValue("all");
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue("all");
    await expect(page.getByLabel("Workflow status", { exact: true })).toHaveValue("all");
    await toggle.click();
  });

  await test.step("A failed result request retains the search; Retry restores the results", async () => {
    // Deliberately simulate only one failed GET; all other traffic uses the real backend.
    await page.route((url) => url.pathname === `${api}/questions` && url.searchParams.get("search") === prefix, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Temporary test failure" }) }), { times: 1 });
    await page.getByRole("searchbox").fill(prefix);
    await expect(page.getByText(/Your search and filters have been kept/)).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue(prefix);
    await expect(table(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(rowFor(page, id)).toBeVisible();
    await noOverflow(page);
  });

  await test.step("View and Edit links navigate to the real detail and editor routes", async () => {
    await rowFor(page, id).getByRole("link", { name: `View ${shortId(id)}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/questions/${id}/?$`));
    await expect(page.getByRole("heading", { level: 1, name: /Question Details/ })).toBeVisible();
    await page.getByRole("link", { name: "Back to Question Bank", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/questions\/?$/);
    await searchFor(page, prefix, id);
    await rowFor(page, id).getByRole("link", { name: `Edit ${shortId(id)}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/questions/${id}/edit/?$`));
    await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeVisible();
  });
});

test("JHEP-207: Question Bank Edit links follow review state and contributor ownership", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(mobile);
  const fixture = createFixture();
  const context = await browser.newContext({ baseURL, viewport: mobile });
  try {
    const contributor = await context.newPage();
    await signInAdmin(page, fixture);
    await signIn(contributor, fixture.contributor);
    await expect(contributor).toHaveURL(/\/admin\/questions\/?$/);
    const scope = { certificationId: fixture.certification_id, categoryId: fixture.category_id };
    const prefix = `QB-ROLE-${randomUUID().slice(0, 12)}`;
    const draft = await createDraft(contributor, scope, `${prefix} draft?`);
    const submitted = await createDraft(contributor, scope, `${prefix} submitted?`);
    await transition(contributor, submitted, "submit");
    const reviewing = await createDraft(contributor, scope, `${prefix} reviewing?`);
    await transition(contributor, reviewing, "submit");
    await transition(page, reviewing, "start-review");
    const rejected = await createDraft(contributor, scope, `${prefix} rejected?`);
    await transition(contributor, rejected, "submit");
    await transition(page, rejected, "start-review");
    await transition(page, rejected, "reject", { review_note: "Reject this disposable regression fixture." });
    const published = await createDraft(contributor, scope, `${prefix} published?`);
    await transition(page, published, "publish");
    const retired = await createDraft(contributor, scope, `${prefix} retired?`);
    await transition(page, retired, "publish");
    await transition(page, retired, "retire", { confirm: true });
    const adminDraft = await createDraft(page, scope, `${prefix} administrator draft?`);

    await openBank(contributor);
    await searchFor(contributor, prefix, draft);
    await expect(table(contributor).getByRole("link", { name: /^View Q-/ })).toHaveCount(6);
    const statuses = [[draft, "Draft"], [submitted, "Submitted"], [reviewing, "In Review"], [rejected, "Rejected"], [published, "Published"], [retired, "Retired"]] as const;
    for (const [id, label] of statuses) {
      const row = rowFor(contributor, id);
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      await expect(row.getByRole("link", { name: `Edit ${shortId(id)}`, exact: true })).toHaveCount(id === draft ? 1 : 0);
    }
    await expect(rowFor(contributor, adminDraft)).toHaveCount(0);
    await noOverflow(contributor);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openBank(page);
    await searchFor(page, prefix, adminDraft);
    await expect(table(page).getByRole("link", { name: /^View Q-/ })).toHaveCount(7);
    for (const [id] of [...statuses, [adminDraft, "Draft"] as const]) {
      const editable = id === draft || id === adminDraft || id === published;
      await expect(rowFor(page, id).getByRole("link", { name: `Edit ${shortId(id)}`, exact: true })).toHaveCount(editable ? 1 : 0);
    }
    await expect(rowFor(page, published).getByRole("link", { name: `Edit ${shortId(published)}`, exact: true })).toHaveAttribute("title", "Create a draft revision");
    await noOverflow(page);
  } finally {
    await context.close();
  }
});
