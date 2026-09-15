import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

import { readAdminDevelopmentConfig } from "../../apps/admin/config.ts";
import { readAdminBrowserConfig } from "../../apps/admin/src/config.ts";
import { readApiConfig } from "../../apps/api/src/app/config.ts";
import {
  readStorefrontBrowserConfig,
} from "../../apps/storefront/lib/config/browser.ts";
import {
  readStorefrontServerConfig,
  validateStorefrontConfiguration,
} from "../../apps/storefront/lib/config/server.ts";
import { createStorefrontCommand } from "../../apps/storefront/scripts/next.mjs";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/madeup_video";

test("derives the default local application topology", () => {
  assert.deepEqual(readApiConfig({ DATABASE_URL: databaseUrl }), {
    port: 3333,
    apiOrigin: "http://127.0.0.1:3333",
    storefrontOrigin: "http://localhost:3000",
    adminOrigin: "http://127.0.0.1:3200",
    databaseUrl,
  });
  assert.deepEqual(readStorefrontServerConfig({}), {
    apiOrigin: "http://127.0.0.1:3333",
    port: 3000,
  });
  assert.deepEqual(readStorefrontBrowserConfig({}), {
    apiOrigin: "http://127.0.0.1:3333",
  });
  assert.deepEqual(readAdminBrowserConfig({}), {
    apiOrigin: "http://127.0.0.1:3333",
  });
  assert.doesNotThrow(() => readAdminDevelopmentConfig({}));
});

test("accepts coherent local port and origin overrides", () => {
  assert.deepEqual(
    readApiConfig({
      API_PORT: "43120",
      STOREFRONT_PORT: "43121",
      STOREFRONT_URL: "http://localhost:43121",
      ADMIN_PORT: "43122",
      ADMIN_URL: "http://127.0.0.1:43122",
      DATABASE_URL: databaseUrl,
    }),
    {
      port: 43120,
      apiOrigin: "http://127.0.0.1:43120",
      storefrontOrigin: "http://localhost:43121",
      adminOrigin: "http://127.0.0.1:43122",
      databaseUrl,
    },
  );
  assert.deepEqual(readStorefrontServerConfig({ API_URL: "http://127.0.0.1:43120" }), {
    apiOrigin: "http://127.0.0.1:43120",
    port: 3000,
  });
  assert.deepEqual(
    readStorefrontBrowserConfig({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:43120" }),
    { apiOrigin: "http://127.0.0.1:43120" },
  );
  assert.deepEqual(readAdminBrowserConfig({ VITE_API_URL: "http://127.0.0.1:43120" }), {
    apiOrigin: "http://127.0.0.1:43120",
  });
  assert.deepEqual(readStorefrontServerConfig({ API_PORT: "43120", STOREFRONT_PORT: "43121" }), {
    apiOrigin: "http://127.0.0.1:43120",
    port: 43121,
  });
});

test("passes the validated storefront port to Next as a structured argument", () => {
  const rootDirectory = join(process.cwd(), "course", "fixture");
  const command = createStorefrontCommand("dev", {
    rootDirectory,
    environment: { STOREFRONT_PORT: "43121" },
    nodeExecutable: "/node",
  });

  assert.deepEqual(command, {
    command: "/node",
    args: [
      join(rootDirectory, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--port=43121",
    ],
    options: {
      cwd: join(rootDirectory, "apps", "storefront"),
      shell: false,
      stdio: "inherit",
    },
  });
});

test("rejects missing and invalid application URLs", () => {
  assert.throws(
    () => readApiConfig({ DATABASE_URL: "" }),
    /DATABASE_URL.*valid URL/i,
  );
  assert.throws(
    () => readApiConfig({ DATABASE_URL: "https://database.example.test/madeup_video" }),
    /DATABASE_URL.*PostgreSQL URL.*postgresql:\/\/|postgres:\/\//i,
  );
  for (const malformedDatabaseUrl of [
    "postgresql:opaque",
    "postgresql:///madeup_video",
    "postgresql://localhost",
  ]) {
    assert.throws(
      () => readApiConfig({ DATABASE_URL: malformedDatabaseUrl }),
      /DATABASE_URL.*host and database name/i,
    );
  }
  assert.throws(
    () => readStorefrontServerConfig({ API_URL: "not a URL" }),
    /API_URL.*valid HTTP URL/i,
  );
  assert.throws(
    () => readStorefrontBrowserConfig({ NEXT_PUBLIC_API_URL: "ftp:\/\/127.0.0.1" }),
    /NEXT_PUBLIC_API_URL.*valid HTTP URL/i,
  );
  assert.throws(
    () => readAdminBrowserConfig({ VITE_API_URL: "" }),
    /VITE_API_URL.*valid HTTP URL/i,
  );
  assert.throws(
    () => readStorefrontBrowserConfig({ NEXT_PUBLIC_API_URL: "http://user:password@127.0.0.1:3333" }),
    /NEXT_PUBLIC_API_URL.*origin/i,
  );
});

test("never repeats rejected URL credentials or query values in diagnostics", () => {
  const secret = "S07_REJECTED_SECRET_8a1d";
  const cases = [
    () => readApiConfig({
      DATABASE_URL: databaseUrl,
      STOREFRONT_URL: `http://user:${secret}@localhost:3000`,
    }),
    () => readStorefrontServerConfig({ API_URL: `http://user:${secret}@127.0.0.1:3333` }),
    () => readStorefrontBrowserConfig({ NEXT_PUBLIC_API_URL: `http://127.0.0.1:3333?token=${secret}` }),
    () => readAdminDevelopmentConfig({ API_URL: `http://127.0.0.1:3333?token=${secret}` }),
    () => readAdminBrowserConfig({ VITE_API_URL: `http://user:${secret}@127.0.0.1:3333` }),
  ];

  for (const reject of cases) {
    assert.throws(reject, (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

test("rejects application ports outside 1 through 65535", () => {
  for (const [name, value] of [
    ["API_PORT", "0"],
    ["API_PORT", "65536"],
    ["STOREFRONT_PORT", "1.5"],
    ["ADMIN_PORT", "not-a-port"],
  ]) {
    assert.throws(
      () => readApiConfig({ [name]: value, DATABASE_URL: databaseUrl }),
      new RegExp(`${name}.*integer from 1 through 65535`, "i"),
    );
  }
});

test("rejects colliding application ports before startup", () => {
  assert.throws(
    () => readApiConfig({ API_PORT: "3200", DATABASE_URL: databaseUrl }),
    /API_PORT and ADMIN_PORT both resolve to 3200/i,
  );
  assert.throws(
    () => readApiConfig({ ADMIN_PORT: "3000", DATABASE_URL: databaseUrl }),
    /STOREFRONT_PORT and ADMIN_PORT both resolve to 3000/i,
  );
});

test("rejects configured origins that disagree with their application ports", () => {
  assert.throws(
    () =>
      readApiConfig({
        STOREFRONT_PORT: "3100",
        STOREFRONT_URL: "http://localhost:3000",
        DATABASE_URL: databaseUrl,
      }),
    /STOREFRONT_URL.*STOREFRONT_PORT/i,
  );
});

test("rejects disagreement between storefront server and browser API origins", () => {
  assert.throws(
    () =>
      validateStorefrontConfiguration({
        API_URL: "http://127.0.0.1:3333",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4444",
      }),
    /API_URL and NEXT_PUBLIC_API_URL must match/i,
  );
  assert.throws(
    () =>
      validateStorefrontConfiguration({
        API_PORT: "3333",
        API_URL: "http://127.0.0.1:4444",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4444",
      }),
    /API_URL.*API_PORT/i,
  );
});

test("rejects disagreement between admin server and browser API origins", () => {
  assert.throws(
    () =>
      readAdminDevelopmentConfig({
        API_PORT: "43120",
        API_URL: "http://127.0.0.1:43120",
      }),
    /API_URL and VITE_API_URL must match/i,
  );
  assert.throws(
    () =>
      readAdminDevelopmentConfig({
        API_URL: "http://127.0.0.1:3333",
        VITE_API_URL: "http://127.0.0.1:4444",
      }),
    /API_URL and VITE_API_URL must match/i,
  );
  assert.throws(
    () =>
      readAdminDevelopmentConfig({
        API_PORT: "3333",
        API_URL: "http://127.0.0.1:4444",
        VITE_API_URL: "http://127.0.0.1:4444",
      }),
    /API_URL.*API_PORT/i,
  );
});

test("rejects incoherent root Vite env files before admin serve or build", async (t) => {
  const adminDirectoryUrl = new URL("../../apps/admin/", import.meta.url);
  const adminDirectory = fileURLToPath(adminDirectoryUrl);
  const repositoryDirectoryUrl = new URL("../../", import.meta.url);
  const mode = `configuration-mismatch-${process.pid}`;
  const environmentFile = new URL(`.env.${mode}`, repositoryDirectoryUrl);
  const configFile = fileURLToPath(new URL("vite.config.ts", adminDirectoryUrl));
  const originalEnvironment = new Map();

  for (const name of ["API_PORT", "ADMIN_PORT", "API_URL", "VITE_API_URL"]) {
    originalEnvironment.set(name, process.env[name]);
    delete process.env[name];
  }

  await writeFile(
    environmentFile,
    [
      "API_PORT=3333",
      "API_URL=http://127.0.0.1:3333",
      "VITE_API_URL=http://127.0.0.1:4444",
      "",
    ].join("\n"),
  );
  t.after(async () => {
    await rm(environmentFile, { force: true });
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  for (const command of ["serve", "build"]) {
    await assert.rejects(
      resolveConfig({ configFile, root: adminDirectory, mode, logLevel: "silent" }, command, mode),
      /API_URL and VITE_API_URL must match/i,
    );
  }
});
