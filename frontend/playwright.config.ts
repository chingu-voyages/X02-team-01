import {
  defineConfig,
  devices,
} from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,

  expect: {
    timeout: 20_000,
  },

  globalSetup:
    "./e2e/global-setup.ts",

  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
      },
    ],
  ],

  use: {
    baseURL:
      "http://localhost:3030",
    trace:
      "retain-on-failure",
    screenshot:
      "only-on-failure",
    video:
      "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices[
          "Desktop Chrome"
        ],
      },
    },
  ],

  webServer: [
    {
      command:
        ".venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010",
      cwd: "../backend",
      url:
        "http://127.0.0.1:8010/health",
      reuseExistingServer:
        true,
      timeout:
        120_000,
    },
    {
      command:
        "npm run dev -- --port 3030",
      cwd:
        ".",
      url:
        "http://localhost:3030/login",
      reuseExistingServer:
        true,
      timeout:
        120_000,
    },
  ],
});
