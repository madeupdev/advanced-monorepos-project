import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "../../tests/helpers/environment.ts";

const apiOrigin = "http://127.0.0.1:3333";
const storefrontOrigin = "http://127.0.0.1:3100";
const serverEnvironment = {
  API_URL: apiOrigin,
  NEXT_PUBLIC_API_URL: apiOrigin,
  STOREFRONT_URL: storefrontOrigin,
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
};

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
    baseURL: storefrontOrigin,
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
  webServer: [
    {
      command: "pnpm exec nx run @madeup-video/api:dev",
      cwd: "../..",
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000,
      },
      env: {
        ...serverEnvironment,
        API_PORT: "3333",
      },
    },
    {
      command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
      cwd: ".",
      url: storefrontOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000,
      },
      env: serverEnvironment,
    },
  ],
});
