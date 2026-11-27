import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatorCode, localPython, type Credentials } from "./helpers/admin-mfa";

type Fixture = { administrator: Credentials & { totp_secret: string }; contributor: Credentials };
type Login = { access_token: string; mfa_required: boolean; learner: { id: string; role: string } };

function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }

async function passwordLogin(request: APIRequestContext, credentials: Credentials): Promise<Login> {
  const response = await request.post("/api/v1/auth/login", { data: { email: credentials.email, password: credentials.password } });
  expect(response.status()).toBe(200);
  return await response.json() as Login;
}

async function mfaLogin(request: APIRequestContext, credentials: Credentials, secret: string): Promise<Login> {
  const challenge = await passwordLogin(request, credentials);
  expect(challenge.mfa_required).toBe(true);
  const response = await request.post("/api/v1/auth/mfa/verify", { headers: bearer(challenge.access_token), data: { code: authenticatorCode(secret) } });
  expect(response.status()).toBe(200);
  return await response.json() as Login;
}

async function signInAdministrator(page: Page, credentials: Fixture["administrator"]) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(authenticatorCode(credentials.totp_secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/questions");
}

async function currentToken(page: Page) {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated browser token");
  return token;
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("JHEP-207: mobile Users & Access, grading permissions and explicit audited administrator promotion", async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = JSON.parse(localPython(["-m", "scripts.seed_exam_publication_e2e", "--confirm-local"])) as Fixture;
  await page.setViewportSize({ width: 320, height: 812 });
  await signInAdministrator(page, fixture.administrator);
  const actor = await currentToken(page);
  const target = await passwordLogin(page.request, fixture.contributor);
  expect(target.mfa_required).toBe(false);
  const promotionPath = `/api/v1/admin/users/${target.learner.id}/administrator-promotion`;
  await page.goto("/admin/users");
  await page.getByRole("searchbox", { name: "Search accounts by email or name" }).fill(fixture.contributor.email);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: fixture.contributor.email });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("contributor", { exact: true })).toBeVisible();
  await noOverflow(page);

  await test.step("Save the edited grading permissions", async () => {
    await row.getByRole("button", { name: "Grading Permissions" }).click();
    const grading = page.getByRole("dialog", { name: "Written-response grading permissions" });
    await grading.getByRole("checkbox", { name: /Grade short answers/ }).check();
    await grading.getByRole("button", { name: "Save permissions" }).click();
    await expect(page.getByText(/grading permissions were saved/)).toBeVisible();
    await expect(row.getByText("Grades: short answers", { exact: true })).toBeVisible();
  });

  await test.step("Block promotion until the target completes MFA", async () => {
    await row.getByRole("button", { name: "Grant Administrator access" }).click();
    const dialog = page.getByRole("dialog", { name: "Grant Administrator access" });
    await expect(dialog.getByText("Account not eligible", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm Administrator promotion" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(row.getByRole("button", { name: "Grant Administrator access" })).toBeFocused();
  });

  const setup = await page.request.post("/api/v1/auth/mfa/enroll/setup", { headers: bearer(target.access_token) });
  expect(setup.status()).toBe(200);
  const { secret } = await setup.json() as { secret: string };
  const enrollment = await page.request.post("/api/v1/auth/mfa/enroll/verify", { headers: bearer(target.access_token), data: { code: authenticatorCode(secret) } });
  expect(enrollment.status()).toBe(200);
  const oldContributorSession = await mfaLogin(page.request, fixture.contributor, secret);
  expect(oldContributorSession.learner.role).toBe("contributor");

  await test.step("Require explicit email, reason and acknowledgement before granting access", async () => {
    await row.getByRole("button", { name: "Grant Administrator access" }).click();
    const dialog = page.getByRole("dialog", { name: "Grant Administrator access" });
    await expect(dialog.getByText("All account eligibility checks passed.")).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Confirm Administrator promotion" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Reason for granting access").fill("Local end-to-end security verification");
    await dialog.getByLabel("Confirm the account email").fill("wrong@example.test");
    await dialog.getByRole("checkbox", { name: /I understand that this grants/ }).check();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Confirm the account email").fill(fixture.contributor.email);
    await expect(confirm).toBeEnabled();
    // Cancel once after all inputs are valid: no permission change should occur.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const stillContributor = await page.request.get(promotionPath, { headers: bearer(actor) });
    expect(stillContributor.status()).toBe(200);
    expect(await stillContributor.json()).toMatchObject({ target: { role: "contributor" }, eligible: true });

    await row.getByRole("button", { name: "Grant Administrator access" }).click();
    await expect(dialog.getByText("All account eligibility checks passed.")).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Reason for granting access").fill("Local end-to-end security verification");
    await dialog.getByLabel("Confirm the account email").fill(fixture.contributor.email);
    await dialog.getByRole("checkbox", { name: /I understand that this grants/ }).check();
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 812 });
      await noOverflow(page);
      await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await expect(confirm).toBeEnabled();
    }
    const [response] = await Promise.all([
      page.waitForResponse((result) => new URL(result.url()).pathname === promotionPath && result.request().method() === "POST"),
      confirm.click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ user: { role: "administrator" }, audit_id: expect.any(String), previous_privileged_sessions_revoked: true });
    await expect(page.getByText(/is now an Administrator/)).toBeVisible();
    await expect(row.getByText("administrator", { exact: true })).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  await test.step("Invalidate the old Contributor session and require fresh MFA for administrator access", async () => {
    const stale = await page.request.get("/api/v1/admin/questions", { headers: bearer(oldContributorSession.access_token) });
    expect(stale.status()).toBe(401);
    const signedIn = await mfaLogin(page.request, fixture.contributor, secret);
    expect(signedIn.learner.role).toBe("administrator");
    const allowed = await page.request.get("/api/v1/admin/users", { headers: bearer(signedIn.access_token) });
    expect(allowed.status()).toBe(200);
  });
});
