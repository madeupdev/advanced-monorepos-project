import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { findValueInFiles } from "../../scripts/lib/browser-bundle-leakage.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const nxCli = fileURLToPath(
  new URL("../../node_modules/nx/dist/bin/nx.js", import.meta.url),
);
const storefrontOutput = join(root, "apps/storefront/.next");
const storefrontBrowserOutput = join(storefrontOutput, "static");
const adminOutput = join(root, "dist/apps/admin");

test("detects a sentinel in a generated browser fixture", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "madeup-video-browser-leak-fixture-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(join(fixture, "assets"));
  await writeFile(join(fixture, "assets/application.js"), "const leaked = 'server-secret';\n");

  assert.deepEqual(await findValueInFiles(fixture, "server-secret"), [
    join(fixture, "assets/application.js"),
  ]);
});

test("keeps a unique server-only sentinel out of production browser output", async (t) => {
  const nxDirectory = await mkdtemp(join(tmpdir(), "madeup-video-config-build-"));
  const sentinel = `S07_SERVER_ONLY_${randomBytes(12).toString("hex")}`;
  const nodeSearchPaths = [
    join(root, "node_modules/nx/node_modules"),
    join(root, "node_modules"),
    join(root, "node_modules/.pnpm/node_modules"),
    process.env.NODE_PATH,
  ].filter(Boolean);
  t.after(async () => {
    await Promise.all([
      rm(nxDirectory, { recursive: true, force: true }),
      rm(storefrontOutput, { recursive: true, force: true }),
      rm(adminOutput, { recursive: true, force: true }),
    ]);
  });

  await Promise.all([
    rm(storefrontOutput, { recursive: true, force: true }),
    rm(adminOutput, { recursive: true, force: true }),
  ]);

  await exec(
    process.execPath,
    [
      nxCli,
      "run-many",
      "--target=build",
      "--projects=@madeup-video/storefront,@madeup-video/admin",
      "--parallel=1",
      "--skip-nx-cache",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        API_PORT: "3333",
        API_URL: "http://127.0.0.1:3333",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:3333",
        VITE_API_URL: "http://127.0.0.1:3333",
        STOREFRONT_PORT: "3000",
        ADMIN_PORT: "3200",
        DATABASE_URL: `postgresql://postgres:${sentinel}@127.0.0.1:5432/madeup_video`,
        NODE_PATH: nodeSearchPaths.join(delimiter),
        NX_CACHE_DIRECTORY: join(nxDirectory, "cache"),
        NX_WORKSPACE_DATA_DIRECTORY: join(nxDirectory, "workspace-data"),
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  assert.deepEqual(
    await Promise.all([
      findValueInFiles(storefrontBrowserOutput, sentinel),
      findValueInFiles(adminOutput, sentinel),
    ]),
    [[], []],
  );
});
