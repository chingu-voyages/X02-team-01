import { expect, test, type Page } from "@playwright/test";
import { authenticatorCode, createUnenrolledAdministrator, type Credentials } from "./helpers/admin-mfa";

async function signIn(page: Page, credentials: Credentials) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function currentToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem("jhep_auth_token"));
  if (!token) throw new Error("No authenticated browser token");
  return token;
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("JHEP-207: mandatory administrator enrollment, recovery receipt and fresh MFA sign-in", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const credentials = createUnenrolledAdministrator();
  await signIn(page, credentials);
  await expect(page).toHaveURL(/\/account\/security\/?$/);
  await expect(page.getByText("Administrator setup required", { exact: true })).toBeVisible();
  const restrictedToken = await currentToken(page);
  const headers = { Authorization: `Bearer ${restrictedToken}` };
  const blocked = await page.request.get("/api/v1/admin/users", { headers });
  expect(blocked.status()).toBe(403);
  expect(await blocked.json()).toMatchObject({ detail: { code: "MFA_ENROLLMENT_REQUIRED" } });
  expect((await page.request.get("/api/v1/exams/catalog", { headers })).status()).toBe(401);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/account\/security\/?$/);
  await expect(page.getByRole("link", { name: "Users & Access" })).toHaveCount(0);
  await noOverflow(page);

  const [setupResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/mfa/enroll/setup" && response.request().method() === "POST"),
    page.getByRole("button", { name: "Set up two-factor authentication" }).click(),
  ]);
  expect(setupResponse.status()).toBe(200);
  const setup = await setupResponse.json() as { secret: string };
  const input = page.getByLabel("Authenticator code");
  await input.fill("12");
  await page.getByRole("button", { name: "Confirm enrollment" }).click();
  await expect(page.getByText("Enter all six digits from your authenticator.")).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill(authenticatorCode(setup.secret));
  await page.getByRole("button", { name: "Confirm enrollment" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor authentication enabled" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").first()).toBeVisible();
  expect((await page.request.get("/api/v1/admin/users", { headers })).status()).toBe(401);
  const finish = page.getByRole("button", { name: "Sign in again" });
  await expect(finish).toBeDisabled();
  await page.getByRole("checkbox", { name: "I have saved my recovery codes securely." }).check();
  await noOverflow(page);
  await finish.click();
  await expect(page).toHaveURL(
  (url) => url.pathname === "/login",
  );

  await expect(
    page.getByRole("heading", { name: "Sign in to your account" }),
  ).toBeVisible();

  await signIn(page, credentials);
  await expect(page.getByRole("heading", { name: "Two-factor verification" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(authenticatorCode(setup.secret));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/?$/);
  const fullToken = await currentToken(page);
  expect((await page.request.get("/api/v1/admin/users", { headers: { Authorization: `Bearer ${fullToken}` } })).status()).toBe(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users & Access" })).toBeVisible();
});
