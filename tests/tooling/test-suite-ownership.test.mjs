import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

const readProject = async (path) => JSON.parse(
  await readFile(new URL(path, import.meta.url), "utf8"),
);

test("makes the deterministic unit suite explicitly cacheable from declared inputs", async () => {
  const [nx, storefront] = await Promise.all([
    readProject("../../nx.json"),
    readProject("../../apps/storefront/project.json"),
  ]);

  assert.deepEqual(nx.namedInputs.unitTestSources, [
    "default",
    "{workspaceRoot}/tests/unit/**/*",
    "{workspaceRoot}/vitest.config.ts",
    { runtime: "node --version" },
    { runtime: "pnpm --version" },
  ]);
  assert.equal(storefront.targets["test:unit"].cache, true);
  assert.deepEqual(storefront.targets["test:unit"].inputs, [
    "unitTestSources",
    "^unitTestSources",
  ]);
  assert.equal("outputs" in storefront.targets["test:unit"], false);
});

test("keeps database, API-contract, and browser suites uncached without replay outputs", async () => {
  const [storefront, apiE2e, adminE2e] = await Promise.all([
    readProject("../../apps/storefront/project.json"),
    readProject("../../apps/api-e2e/project.json"),
    readProject("../../apps/admin-e2e/project.json"),
  ]);
  const suites = [
    storefront.targets["test:integration"],
    apiE2e.targets.test,
    storefront.targets["test:e2e"],
    adminE2e.targets.test,
  ];

  for (const suite of suites) {
    assert.equal(suite.cache, false);
    assert.equal("outputs" in suite, false);
  }
});

test("does not infer cacheable Playwright CI targets", async () => {
  const { stdout } = await exec("pnpm", ["exec", "nx", "show", "project", "@madeup-video/admin-e2e", "--json"], {
    env: {
      ...process.env,
      TEST_DATABASE_URL: "postgresql://course:course@127.0.0.1:5432/madeup_video_test",
      NX_DAEMON: "false",
      NX_NO_CLOUD: "true",
      NX_PREFER_NODE_STRIP_TYPES: "false",
    },
  });
  const project = JSON.parse(stdout);
  assert.equal(project.targets.e2e.cache, false);
  assert.equal(Object.keys(project.targets).some((name) => name.startsWith("e2e-ci")), false);
});

test("gives repository tooling its own uncached Nx target", async () => {
  const [storefront, testing, tooling] = await Promise.all([
    readProject("../../apps/storefront/project.json"),
    readProject("../../libs/testing/project.json"),
    readProject("./project.json"),
  ]);

  assert.equal("test:tooling" in storefront.targets, false);
  assert.equal("test:tooling" in (testing.targets ?? {}), false);
  assert.equal(tooling.name, "@madeup-video/repository-tooling");
  assert.equal(tooling.sourceRoot, "tests/tooling");
  assert.deepEqual(tooling.implicitDependencies, ["*"]);
  assert.equal(tooling.targets["test:tooling"].cache, false);
  assert.equal(
    tooling.targets["test:tooling"].options.command,
    "node --test tests/tooling/**/*.test.mjs",
  );
  assert.equal("outputs" in tooling.targets["test:tooling"], false);
});
