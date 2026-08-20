import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "../../tests/helpers/environment.ts";

const apiOrigin = "http://127.0.0.1:3333";
const adminOrigin = "http://127.0.0.1:3200";
const environment = {
  ADMIN_URL: adminOrigin,
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
};

export default defineConfig({
  testDir: "./src",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL: adminOrigin, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec nx run @madeup-video/api:dev",
      cwd: "../..",
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...environment, API_PORT: "3333" },
    },
    {
      command: "pnpm exec nx run @madeup-video/admin:dev",
      cwd: "../..",
      url: adminOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...environment, VITE_API_URL: apiOrigin },
    }
  ],
});
