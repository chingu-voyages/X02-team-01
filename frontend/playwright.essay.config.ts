import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/** Essay-only matrix. Do not run the shared demo-account global seeder. */
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testDir: "./e2e",
  testMatch: "**/essay-responses.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/essay",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/essay" }],
  ],
  use: {
    ...base.use,
    serviceWorkers: "block",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"] } },
    { name: "chromium-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "chromium-320", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 740 } } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"] } },
  ],
});
