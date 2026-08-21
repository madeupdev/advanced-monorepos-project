import { defineConfig, devices } from '@playwright/test';

const rawAdminPort = process.env.ADMIN_PORT ?? '3200';
const adminPort = Number(rawAdminPort);

if (!Number.isSafeInteger(adminPort) || adminPort < 1 || adminPort > 65_535) {
  throw new Error(`ADMIN_PORT must be an integer from 1 through 65535; received ${rawAdminPort}.`);
}

const adminOrigin = `http://127.0.0.1:${adminPort}`;

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: adminOrigin,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm exec nx run @madeup-video/admin:dev -- --port=${adminPort}`,
    cwd: '../..',
    url: adminOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
