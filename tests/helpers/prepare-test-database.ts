import { spawnSync } from "node:child_process";
import { disconnectTestDatabase, resetTestDatabase } from "./database";
import { testDatabaseUrl } from "./environment";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const migration = spawnSync(
  pnpmCommand,
  ["exec", "prisma", "migrate", "deploy"],
  {
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
    },
    stdio: "inherit",
  },
);

if (migration.error) {
  throw migration.error;
}

if (migration.status !== 0) {
  throw new Error(
    `Test database migration failed with exit code ${migration.status ?? "unknown"}.`,
  );
}

await resetTestDatabase();
await disconnectTestDatabase();
