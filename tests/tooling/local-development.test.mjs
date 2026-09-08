import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LocalDevelopmentError,
  createDevelopmentCommand,
  developmentProjects,
  runDevelopment,
} from "../../scripts/lib/local-development.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("maps each named local-development profile to its stable projects", () => {
  assert.deepEqual(developmentProjects("api"), ["@madeup-video/api"]);
  assert.deepEqual(developmentProjects("storefront"), [
    "@madeup-video/api",
    "@madeup-video/storefront",
  ]);
  assert.deepEqual(developmentProjects("admin"), [
    "@madeup-video/api",
    "@madeup-video/admin",
  ]);
  assert.deepEqual(developmentProjects("full"), [
    "@madeup-video/api",
    "@madeup-video/storefront",
    "@madeup-video/admin",
  ]);
});

for (const [profile, received] of [
  [undefined, "missing"],
  ["", '""'],
  ["mobile", '"mobile"'],
  ["toString", '"toString"'],
  ["constructor", '"constructor"'],
  ["__proto__", '"__proto__"'],
]) {
  test(`rejects the unsupported ${received} profile with a focused message`, () => {
    assert.throws(
      () => developmentProjects(profile),
      (error) => {
        assert.ok(error instanceof LocalDevelopmentError);
        assert.equal(
          error.message,
          `Unknown local-development profile ${received}. Choose one of: api, storefront, admin, full.`,
        );
        return true;
      },
    );
  });
}

test("builds a direct Node command for the installed Nx CLI", () => {
  assert.deepEqual(
    createDevelopmentCommand("admin", {
      rootDirectory: "/workspace",
      nodeExecutable: "node",
    }),
    {
      command: "node",
      args: [
        "/workspace/node_modules/nx/dist/bin/nx.js",
        "run-many",
        "--target=dev",
        "--projects=@madeup-video/api,@madeup-video/admin",
      ],
    },
  );
});

test("returns and prints the dry-run command without spawning", async () => {
  let spawned = false;
  const output = [];
  const command = await runDevelopment("storefront", {
    rootDirectory: "/workspace",
    nodeExecutable: "node",
    dryRun: true,
    write: (line) => output.push(line),
    spawn: () => {
      spawned = true;
    },
  });

  assert.equal(spawned, false);
  assert.deepEqual(command, {
    command: "node",
    args: [
      "/workspace/node_modules/nx/dist/bin/nx.js",
      "run-many",
      "--target=dev",
      "--projects=@madeup-video/api,@madeup-video/storefront",
    ],
  });
  assert.match(output.join(""), /@madeup-video\/storefront/);
});

test("supervises one structured Nx child without a shell and preserves its failure", async () => {
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 17));
    return child;
  };

  await assert.rejects(
    runDevelopment("api", {
      rootDirectory: "/workspace",
      nodeExecutable: "node",
      spawn,
    }),
    /exit code 17/i,
  );

  assert.deepEqual(calls, [[
    "node",
    [
      "/workspace/node_modules/nx/dist/bin/nx.js",
      "run-many",
      "--target=dev",
      "--projects=@madeup-video/api",
    ],
    { cwd: "/workspace", shell: false, stdio: "inherit" },
  ]]);
});

test("provides root scripts for the focused local profiles", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url)),
  );

  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs full");
  assert.equal(packageJson.scripts["dev:api"], "node scripts/dev.mjs api");
  assert.equal(
    packageJson.scripts["dev:storefront"],
    "node scripts/dev.mjs storefront",
  );
  assert.equal(packageJson.scripts["dev:admin"], "node scripts/dev.mjs admin");
  assert.equal(packageJson.scripts["dev:full"], "node scripts/dev.mjs full");
});

test("documents the full and focused local-development workflows", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");

  assert.match(readme, /`pnpm dev` starts the API, storefront, and admin/i);
  assert.match(readme, /pnpm dev:api/);
  assert.match(readme, /pnpm dev:storefront/);
  assert.match(readme, /pnpm dev:admin/);
  assert.match(readme, /pnpm dev:full/);
  assert.match(readme, /http:\/\/localhost:3000/);
  assert.match(readme, /http:\/\/localhost:3333/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:3200/);
});

test("setup completion guidance describes the full development workflow", async () => {
  const setupScript = await readFile(
    new URL("../../scripts/setup.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    setupScript,
    /Run "pnpm dev" to start the API, storefront, and admin applications\./,
  );
});

test("CLI dry-run is inspectable without starting Nx", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/dev.mjs", "admin", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node_modules[\\/]nx[\\/]dist[\\/]bin[\\/]nx\.js/);
  assert.match(result.stdout, /@madeup-video\/api,@madeup-video\/admin/);
});
