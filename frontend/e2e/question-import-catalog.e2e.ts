import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Workbook } from "exceljs";

import type {
  AdminCategory,
  AdminCategoryListResponse,
  AdminCertification,
  AdminCertificationListResponse,
} from "../src/types/admin-catalog-api.types";
import type {
  AdminQuestionBankListResponse,
  AdminQuestionDetail,
} from "../src/types/admin-question-api.types";
import type {
  QuestionImportBatch,
  QuestionImportCommitResponse,
  QuestionImportHistoryPage,
  QuestionImportRowsPage,
} from "../src/types/question-import-api.types";
import type {
  ImportCatalogConfirmationResponse,
  ImportCatalogPlan,
} from "../src/lib/question-import-catalog-api";

type Credentials = { email: string; password: string };
type Fixture = {
  administrator: Credentials & { totp_secret: string };
  contributor: Credentials;
  certification_id: string;
};
type WorkbookRow = { code: string; category: string; question: string; image?: string };

const backend = path.resolve(process.cwd(), "../backend");
const importPath = "/api/v1/admin/question-imports";
const catalogPath = "/api/v1/admin";
const mobile = { width: 375, height: 812 };
const headersRow = [
  "template_version", "certification_code", "category_name", "difficulty",
  "question_type", "allows_multiple_answers", "question_text", "option_a",
  "option_b", "option_c", "option_d", "option_e", "option_f", "correct_answers",
  "expected_answer", "explanation", "image_filename", "image_alt_text",
];

function runPython(args: string[], input?: string): string {
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, {
    cwd: backend, env: process.env, encoding: "utf8", input, timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Local catalog fixture failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

function createFixture(): Fixture {
  return JSON.parse(runPython(["-m", "scripts.seed_exam_publication_e2e", "--confirm-local"])) as Fixture;
}

function runId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

async function createWorkbook(testInfo: TestInfo, name: string, rows: WorkbookRow[]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Questions");
  sheet.addRow(headersRow);
  for (const row of rows) {
    sheet.addRow([
      "2.0", row.code, row.category, "easy", "multiple_choice", false,
      row.question, "Option A", "Option B", null, null, null, null, "A",
      null, "Option A is correct for this local regression fixture.",
      row.image ?? null, row.image ? "Fixture diagram" : null,
    ]);
  }
  const filename = testInfo.outputPath(name);
  await mkdir(path.dirname(filename), { recursive: true });
  await workbook.xlsx.writeFile(filename);
  return filename;
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
  const code = runPython(["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"], fixture.administrator.totp_secret);
  await page.getByLabel("Authenticator code").fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/?$/);
}

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated session");
  return { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" };
}

async function read<T>(page: Page, pathname: string): Promise<T> {
  const response = await page.request.get(pathname, { headers: await authHeaders(page) });
  expect(response.status(), `GET ${pathname}`).toBe(200);
  return (await response.json()) as T;
}

async function certifications(page: Page): Promise<AdminCertification[]> {
  return (await read<AdminCertificationListResponse>(page, `${catalogPath}/certifications`)).items;
}

async function categories(page: Page, certificationId: string): Promise<AdminCategory[]> {
  return (await read<AdminCategoryListResponse>(page, `${catalogPath}/categories?certification_id=${encodeURIComponent(certificationId)}`)).items;
}

async function questionCount(page: Page, search: string): Promise<number> {
  return (await read<AdminQuestionBankListResponse>(page, `${catalogPath}/questions?search=${encodeURIComponent(search)}`)).count;
}

function responseFor(page: Page, pathname: string, method: string) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname && response.request().method() === method,
  );
}

function resolution(page: Page) {
  return page.getByRole("region", { name: "Resolve missing catalog records", exact: true });
}

function acknowledge(page: Page) {
  return resolution(page).getByRole("checkbox", { name: "I confirm creation of the listed catalog records.", exact: true });
}

function createRecordsButton(page: Page) {
  return resolution(page).getByRole("button", { name: "Create records & revalidate", exact: true });
}

async function openImport(page: Page) {
  await page.goto("/admin/questions/import");
  await expect(page.getByRole("heading", { name: "Import Questions", exact: true })).toBeVisible();
}

async function validateFile(page: Page, filename: string, rows: number) {
  await page.getByLabel("Question bank workbook", { exact: true }).setInputFiles(filename);
  const [response] = await Promise.all([
    responseFor(page, importPath, "POST"),
    page.getByRole("button", { name: "Validate File", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  const batch = (await response.json()) as QuestionImportBatch;
  expect(batch).toMatchObject({ status: "invalid", total_rows: rows, imported_rows: 0, can_import: false });
  await expect(resolution(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import blocked", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+ Questions$/ })).toHaveCount(0);
  return batch;
}

async function previewPlan(page: Page, batchId: string, refresh = false) {
  const [response] = await Promise.all([
    responseFor(page, `${importPath}/${batchId}/catalog-plan`, "GET"),
    resolution(page).getByRole("button", { name: refresh ? "Refresh catalog preview" : "Review missing records", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const plan = (await response.json()) as ImportCatalogPlan;
  expect(plan.batch_id).toBe(batchId);
  return plan;
}

async function confirmCatalog(page: Page, batchId: string) {
  await acknowledge(page).check();
  const [response] = await Promise.all([
    responseFor(page, `${importPath}/${batchId}/catalog-confirm`, "POST"),
    createRecordsButton(page).click(),
  ]);
  expect(response.status()).toBe(200);
  return (await response.json()) as ImportCatalogConfirmationResponse;
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const main = page.getByRole("main");
  if (await main.isVisible()) {
    await expect.poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  const table = page.getByRole("table", { name: "Validation rows", exact: true });
  if (await table.isVisible()) {
    await expect.poll(() => table.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
}

async function commitDrafts(page: Page, batchId: string, count: number) {
  const [response] = await Promise.all([
    responseFor(page, `${importPath}/${batchId}/commit`, "POST"),
    page.getByRole("button", { name: `Import ${count} Questions`, exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const receipt = (await response.json()) as QuestionImportCommitResponse;
  expect(receipt).toMatchObject({ created_count: count, already_imported: false, batch: { status: "imported", imported_rows: count } });
  expect(receipt.created_question_ids).toHaveLength(count);
  await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
  return receipt;
}

async function revalidate(page: Page, batchId: string) {
  const [response] = await Promise.all([
    responseFor(page, `${importPath}/${batchId}/revalidate`, "POST"),
    page.getByRole("button", { name: "Revalidate", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  return (await response.json()) as QuestionImportBatch;
}

test("JHEP-207: explicit mobile catalog confirmation creates only the reviewed unpublished records", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize(mobile);
  const fixture = createFixture();
  const id = runId();
  const code = `JHEP207-${id}`;
  const name = `Computer Science ${id}`;
  const prefix = `Catalog confirmation ${id}`;
  const categoryName = `Data Structures ${id}`;
  const otherCategory = `Algorithms ${id}`;
  const filename = await createWorkbook(testInfo, `catalog-${id}.xlsx`, [
    { code, category: categoryName, question: `${prefix}: queue?` },
    { code, category: categoryName.toLowerCase(), question: `${prefix}: stack?` },
    { code, category: otherCategory, question: `${prefix}: sorting?` },
  ]);
  await signInAdmin(page, fixture);
  await openImport(page);

  const batch = await test.step("Upload and validate without creating anything", async () => {
    const result = await validateFile(page, filename, 3);
    expect((await certifications(page)).find((item) => item.code === code)).toBeUndefined();
    expect(await questionCount(page, prefix)).toBe(0);
    const persisted = await read<QuestionImportBatch>(page, `${importPath}/${result.id}`);
    expect(persisted).toMatchObject({ status: "invalid", imported_rows: 0 });
    return result;
  });

  await test.step("Review grouped references and cancel without creating anything", async () => {
    const plan = await previewPlan(page, batch.id);
    expect(plan.can_confirm).toBe(true);
    expect(plan.blocking_issues).toEqual([]);
    expect(plan.missing_certifications).toEqual([{ code, row_numbers: [2, 3, 4] }]);
    expect(plan.missing_categories).toEqual(expect.arrayContaining([
      { certification_code: code, name: categoryName, row_numbers: [2, 3] },
      { certification_code: code, name: otherCategory, row_numbers: [4] },
    ]));
    expect(plan.missing_categories).toHaveLength(2);
    await expect(resolution(page).getByText("1 new certification · 2 new categories", { exact: true })).toBeVisible();
    await expect(createRecordsButton(page)).toBeDisabled();
    await noOverflow(page);
    await acknowledge(page).check();
    await resolution(page).getByRole("button", { name: "Cancel creation", exact: true }).click();
    await expect(resolution(page).getByRole("button", { name: "Review missing records", exact: true })).toBeFocused();
    await expect(createRecordsButton(page)).toHaveCount(0);
    expect((await certifications(page)).find((item) => item.code === code)).toBeUndefined();
    expect(await questionCount(page, prefix)).toBe(0);
  });

  const created = await test.step("Validate fields and explicitly create the reviewed catalog records", async () => {
    const plan = await previewPlan(page, batch.id);
    const nameField = resolution(page).getByLabel(`Certification name (${code})`, { exact: true });
    const thresholdField = resolution(page).getByLabel(`Passing threshold (%) (${code})`, { exact: true });
    await expect(acknowledge(page)).not.toBeChecked();
    await acknowledge(page).check();
    await createRecordsButton(page).click();
    await expect(nameField).toHaveAttribute("aria-invalid", "true");
    await expect(thresholdField).toHaveAttribute("aria-invalid", "true");
    await expect(nameField).toBeFocused();
    await expect(resolution(page).getByText("Enter a certification name from 1 to 255 characters.", { exact: true })).toBeVisible();
    await expect(resolution(page).getByText("Enter a whole-number passing threshold from 0 to 100.", { exact: true })).toBeVisible();
    await nameField.fill(name);
    await thresholdField.fill("101");
    await acknowledge(page).check();
    await createRecordsButton(page).click();
    await expect(thresholdField).toHaveAttribute("aria-invalid", "true");
    expect((await certifications(page)).find((item) => item.code === code)).toBeUndefined();
    await thresholdField.fill("70");
    await resolution(page).getByLabel(`Feedback mode (${code})`, { exact: true }).selectOption("immediate");
    await expect(acknowledge(page)).not.toBeChecked();
    await expect(createRecordsButton(page)).toBeDisabled();
    await noOverflow(page);
    await acknowledge(page).check();
    const [response] = await Promise.all([
      responseFor(page, `${importPath}/${batch.id}/catalog-confirm`, "POST"),
      createRecordsButton(page).click(),
    ]);
    expect(response.request().postDataJSON()).toEqual({
      plan_id: plan.plan_id, confirm: true,
      certifications: [{ code, name, passing_threshold_pct: 70, feedback_mode: "immediate" }],
    });
    expect(response.status()).toBe(200);
    const result = (await response.json()) as ImportCatalogConfirmationResponse;
    expect(result.created_certification_ids).toHaveLength(1);
    expect(result.created_category_ids).toHaveLength(2);
    expect(result.batch).toMatchObject({ status: "ready", valid_rows: 3, error_rows: 0, imported_rows: 0, can_import: true });
    await expect(page.getByText(/Catalog records created: 3\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready to import", exact: true })).toBeVisible();
    expect(await questionCount(page, prefix)).toBe(0);
    const certification = (await certifications(page)).find((item) => item.code === code);
    expect(certification).toMatchObject({ id: result.created_certification_ids[0], code, name, passing_threshold_pct: 70, feedback_mode: "immediate", is_published: false });
    const children = await categories(page, result.created_certification_ids[0]);
    expect(children).toHaveLength(2);
    expect(children.map((item) => item.id).sort()).toEqual([...result.created_category_ids].sort());
    expect(children.every((item) => !item.is_published)).toBe(true);
    return result;
  });

  await test.step("Check responsive validation rows, then import drafts separately", async () => {
    const table = page.getByRole("table", { name: "Validation rows", exact: true });
    const dataRow = table.getByRole("row").filter({ hasText: `${prefix}: queue?` });
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dataRow).toBeVisible();
      await expect(dataRow).toHaveCSS("display", width >= 1280 ? "table-row" : "grid");
      await noOverflow(page);
      await expect(page.getByRole("button", { name: "Import 3 Questions", exact: true })).toBeEnabled();
    }
    const receipt = await commitDrafts(page, batch.id, 3);
    expect(await questionCount(page, prefix)).toBe(3);
    for (const questionId of receipt.created_question_ids) {
      const question = await read<AdminQuestionDetail>(page, `${catalogPath}/questions/${questionId}`);
      expect(question).toMatchObject({ certification_id: created.created_certification_ids[0], review_status: "pending", publication_status: "draft" });
      expect(created.created_category_ids).toContain(question.category_id);
    }
    expect((await certifications(page)).find((item) => item.code === code)?.is_published).toBe(false);
    expect((await categories(page, created.created_certification_ids[0])).every((item) => !item.is_published)).toBe(true);
  });
});

test("JHEP-207: contributor cannot create catalog records; admin resolves a stale preview and owner imports", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize(mobile);
  const fixture = createFixture();
  const id = runId();
  const prefix = `Contributor catalog ${id}`;
  const firstCategory = `Networks ${id}`;
  const secondCategory = `Systems ${id}`;
  const context = await browser.newContext({ baseURL: "http://localhost:3030", viewport: mobile });
  try {
    const contributor = await context.newPage();
    await signInAdmin(page, fixture);
    const certification = (await certifications(page)).find((item) => item.id === fixture.certification_id);
    if (!certification) throw new Error("Missing local fixture certification");
    const filename = await createWorkbook(testInfo, `contributor-${id}.xlsx`, [
      { code: certification.code, category: firstCategory, question: `${prefix}: network?` },
      { code: certification.code, category: secondCategory, question: `${prefix}: system?` },
    ]);
    await signIn(contributor, fixture.contributor);
    await expect(contributor).toHaveURL(/\/admin\/questions\/?$/);
    await openImport(contributor);
    const batch = await validateFile(contributor, filename, 2);
    const history = await read<QuestionImportHistoryPage>(contributor, importPath);
    const uploaded = history.items.find((item) => item.id === batch.id);
    if (!uploaded) throw new Error("Missing contributor import history item");
    expect(uploaded.uploaded_by_email).toBe(fixture.contributor.email);

    await test.step("Contributor preview is read-only and direct confirmation is forbidden", async () => {
      const plan = await previewPlan(contributor, batch.id);
      expect(plan.can_confirm).toBe(false);
      expect(plan.missing_certifications).toEqual([]);
      expect(plan.missing_categories).toHaveLength(2);
      await expect(resolution(contributor).getByText(/Ask an administrator to create the missing records/)).toBeVisible();
      await expect(createRecordsButton(contributor)).toHaveCount(0);
      await expect(acknowledge(contributor)).toHaveCount(0);
      const response = await contributor.request.post(`${importPath}/${batch.id}/catalog-confirm`, {
        headers: await authHeaders(contributor), data: { plan_id: plan.plan_id, confirm: true, certifications: [] },
      });
      expect(response.status()).toBe(403);
      const children = await categories(page, certification.id);
      expect(children.filter((item) => [firstCategory, secondCategory].includes(item.name))).toEqual([]);
      expect(await questionCount(page, prefix)).toBe(0);
      await noOverflow(contributor);
    });

    await test.step("Administrator reopens the same batch; outdated plans cannot create records", async () => {
      await openImport(page);
      // The fixture is the newest workbook. Select its exact history row.
      const historyRow = page.getByText(path.basename(filename), { exact: true }).locator("xpath=../../..");
      await historyRow.getByRole("button", { name: "Review", exact: true }).click();
      await expect(resolution(page)).toBeVisible();
      const oldPlan = await previewPlan(page, batch.id);
      expect(oldPlan.can_confirm).toBe(true);
      expect(oldPlan.missing_categories).toHaveLength(2);
      // Simulate a concurrent administrator resolving one reference using
      // the ordinary catalog endpoint, without changing the staged workbook.
      const manual = await page.request.post(`${catalogPath}/categories`, {
        headers: await authHeaders(page), data: { certification_id: certification.id, name: firstCategory },
      });
      expect(manual.status()).toBe(201);
      const first = (await manual.json()) as AdminCategory;
      await acknowledge(page).check();
      const [conflict] = await Promise.all([
        responseFor(page, `${importPath}/${batch.id}/catalog-confirm`, "POST"),
        createRecordsButton(page).click(),
      ]);
      expect(conflict.status()).toBe(409);
      expect(await conflict.json()).toMatchObject({ detail: { code: "IMPORT_CATALOG_PLAN_CHANGED" } });
      await expect(resolution(page).getByRole("alert")).toContainText("Refresh the catalog preview");
      await expect(createRecordsButton(page)).toBeDisabled();
      await expect(acknowledge(page)).not.toBeChecked();
      expect((await categories(page, certification.id)).filter((item) => item.name === secondCategory)).toHaveLength(0);
      const next = await previewPlan(page, batch.id, true);
      expect(next.plan_id).not.toBe(oldPlan.plan_id);
      expect(next.missing_categories).toEqual([{ certification_code: certification.code, name: secondCategory, row_numbers: [3] }]);
      await expect(acknowledge(page)).not.toBeChecked();
      const result = await confirmCatalog(page, batch.id);
      expect(result.created_certification_ids).toEqual([]);
      expect(result.created_category_ids).toHaveLength(1);
      expect(result.batch).toMatchObject({ status: "ready", imported_rows: 0, can_import: true });
      await expect(page.getByRole("heading", { name: "Ready to import", exact: true })).toBeVisible();
      const children = await categories(page, certification.id);
      expect(children.filter((item) => item.name === firstCategory)).toEqual([first]);
      expect(children.filter((item) => item.name === secondCategory)).toEqual([expect.objectContaining({ id: result.created_category_ids[0], is_published: false })]);
      expect(await questionCount(page, prefix)).toBe(0);
    });

    await test.step("Original contributor revalidates and imports pending drafts", async () => {
      expect(await revalidate(contributor, batch.id)).toMatchObject({ status: "ready", can_import: true });
      await expect(contributor.getByRole("heading", { name: "Ready to import", exact: true })).toBeVisible();
      const receipt = await commitDrafts(contributor, batch.id, 2);
      await expect(contributor.getByRole("button", { name: /Approve & Publish All/ })).toHaveCount(0);
      await expect(contributor.getByText("This import created drafts. Open the Question Bank to submit any remaining drafts for administrator review.", { exact: true })).toBeVisible();
      for (const questionId of receipt.created_question_ids) {
        const question = await read<AdminQuestionDetail>(page, `${catalogPath}/questions/${questionId}`);
        expect(question).toMatchObject({ created_by_id: uploaded.uploaded_by_id, review_status: "pending", publication_status: "draft" });
      }
      expect(await questionCount(page, prefix)).toBe(2);
    });
  } finally {
    await context.close();
  }
});

test("JHEP-207: remaining missing-image errors block import after catalog creation and cancellation preserves only confirmed records", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize(mobile);
  const fixture = createFixture();
  const id = runId();
  const prefix = `Missing image ${id}`;
  const categoryName = `Diagrams ${id}`;
  const imageName = `diagram-${id}.png`;
  await signInAdmin(page, fixture);
  const certification = (await certifications(page)).find((item) => item.id === fixture.certification_id);
  if (!certification) throw new Error("Missing local fixture certification");
  const filename = await createWorkbook(testInfo, `missing-image-${id}.xlsx`, [
    { code: certification.code, category: categoryName, question: `${prefix}: diagram?`, image: imageName },
  ]);
  await openImport(page);
  const batch = await validateFile(page, filename, 1);
  const plan = await previewPlan(page, batch.id);
  expect(plan.can_confirm).toBe(true);
  expect(plan.missing_categories).toEqual([{ certification_code: certification.code, name: categoryName, row_numbers: [2] }]);
  const result = await confirmCatalog(page, batch.id);
  expect(result.created_category_ids).toHaveLength(1);
  expect(result.batch).toMatchObject({ status: "invalid", error_rows: 1, imported_rows: 0, can_import: false });
  await expect(page.getByText(/Resolve the remaining validation issues before importing questions/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add referenced images", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import blocked", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+ Questions$/ })).toHaveCount(0);
  const rows = await read<QuestionImportRowsPage>(page, `${importPath}/${batch.id}/rows`);
  expect(rows.items).toHaveLength(1);
  expect(rows.items[0].issues.map((item) => item.code)).toContain("MISSING_IMAGE_FILE");
  expect(rows.items[0].issues.map((item) => item.code)).not.toContain("CATEGORY_NOT_FOUND");
  expect(await questionCount(page, prefix)).toBe(0);
  await noOverflow(page);
  const blocked = await page.request.post(`${importPath}/${batch.id}/commit`, { headers: await authHeaders(page) });
  expect(blocked.status()).toBe(409);

  await page.getByRole("button", { name: "Cancel Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this import?", exact: true });
  await expect(dialog).toBeVisible();
  await noOverflow(page);
  const [cancelled] = await Promise.all([
    responseFor(page, `${importPath}/${batch.id}/cancel`, "POST"),
    dialog.getByRole("button", { name: "Cancel Import", exact: true }).click(),
  ]);
  expect(cancelled.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Import cancelled", exact: true })).toBeVisible();
  expect(await read<QuestionImportBatch>(page, `${importPath}/${batch.id}`)).toMatchObject({ status: "cancelled", imported_rows: 0 });
  expect(await questionCount(page, prefix)).toBe(0);
  expect((await categories(page, certification.id)).find((item) => item.name === categoryName)).toMatchObject({ id: result.created_category_ids[0], is_published: false });
});
