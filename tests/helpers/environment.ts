import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, parse } from "dotenv";

const testEnvironmentPath = resolve(".env.test");
const incomingDevelopmentDatabaseUrl = process.env.DATABASE_URL;

config({ path: testEnvironmentPath, quiet: true });

function parseDatabaseUrl(value: string, variableName: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${variableName} must be a valid PostgreSQL connection URL.`,
    );
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(
      `${variableName} must use the postgres:// or postgresql:// protocol.`,
    );
  }

  if (!url.hostname || !url.pathname.slice(1)) {
    throw new Error(
      `${variableName} must include a PostgreSQL host and database name.`,
    );
  }

  return url;
}

function readDevelopmentDatabaseUrls(): URL[] {
  const urls: URL[] = [];

  if (incomingDevelopmentDatabaseUrl) {
    urls.push(
      parseDatabaseUrl(incomingDevelopmentDatabaseUrl, "DATABASE_URL"),
    );
  }

  for (const filename of [
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]) {
    const developmentEnvironmentPath = resolve(filename);

    if (!existsSync(developmentEnvironmentPath)) {
      continue;
    }

    const developmentEnvironment = parse(
      readFileSync(developmentEnvironmentPath),
    );
    const value = developmentEnvironment.DATABASE_URL;

    if (value) {
      urls.push(parseDatabaseUrl(value, `DATABASE_URL in ${filename}`));
    }
  }

  return urls;
}

export function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;

  if (!value) {
    throw new Error(
      "TEST_DATABASE_URL is required. Copy .env.test.example to .env.test and point it at a dedicated database ending in _test.",
    );
  }

  const testUrl = parseDatabaseUrl(value, "TEST_DATABASE_URL");
  const databaseName = decodeURIComponent(testUrl.pathname.slice(1));
  const developmentDatabaseNames = readDevelopmentDatabaseUrls().map((url) =>
    decodeURIComponent(url.pathname.slice(1)),
  );

  if (developmentDatabaseNames.includes(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL resolves to the normal development database. Create a separate database whose name ends in _test.",
    );
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL must name a dedicated database ending in _test; received database "${databaseName}".`,
    );
  }

  return testUrl.toString();
}

export const testDatabaseUrl = requireTestDatabaseUrl();

export function setTestDatabaseAsApplicationDatabase(): void {
  process.env.DATABASE_URL = testDatabaseUrl;
}
