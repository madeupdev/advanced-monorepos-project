import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "../../tests/helpers/environment.ts";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: "../../playwright-report", open: "never" }],
  ],
  outputDir: "../../test-results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    cwd: ".",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 5_000,
    },
    env: {
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
    },
  },
});
