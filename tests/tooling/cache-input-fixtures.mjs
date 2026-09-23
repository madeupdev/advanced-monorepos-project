import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const nxCli = fileURLToPath(
  new URL("../../node_modules/nx/dist/bin/nx.js", import.meta.url),
);
const inputRelativePath = "tests/cache-fixture-input.txt";
const projectRelativePath = "tests/tooling/project.json";

function nxEnvironment(workspaceRoot, cacheDirectory, workspaceDataDirectory) {
  const nodeSearchPaths = [
    join(workspaceRoot, "node_modules/nx/node_modules"),
    join(workspaceRoot, "node_modules"),
    join(workspaceRoot, "node_modules/.pnpm/node_modules"),
    process.env.NODE_PATH,
  ].filter(Boolean);

  const environment = {
    ...process.env,
    NODE_PATH: nodeSearchPaths.join(delimiter),
    NX_CACHE_DIRECTORY: cacheDirectory,
    NX_DAEMON: "false",
    NX_NO_CLOUD: "true",
    NX_PREFER_NODE_STRIP_TYPES: "false",
    NX_WORKSPACE_DATA_DIRECTORY: workspaceDataDirectory,
    TEST_DATABASE_URL: "postgresql://course:course@127.0.0.1:5432/madeup_video_test",
  };
  delete environment.NX_SKIP_NX_CACHE;
  return environment;
}

async function runFixture(workspaceRoot, environment) {
  const { stderr, stdout } = await exec(process.execPath, [
    nxCli,
    "run",
    "@madeup-video/repository-tooling:test:cache-input",
  ], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: environment,
  });
  const { value } = JSON.parse(await readFile(join(workspaceRoot, "tests/tooling/dist/observation.json"), "utf8"));
  const { tasks } = JSON.parse(await readFile(join(environment.NX_CACHE_DIRECTORY, "run.json"), "utf8"));
  assert.equal(tasks.length, 1, "cache fixture must run exactly one task");
  const { hash, cacheStatus } = tasks[0];

  return { output: `${stdout}${stderr}`, outputValue: value, hash, cacheStatus };
}

async function assertRestored(path, original) {
  assert.equal(await readFile(path, "utf8"), original, `${path} must be restored`);
}

export async function snapshotWorkspace(destination, sourceRoot = root, requiredPaths = []) {
  const generatedDirectories = new Set([
    ".git", ".nx", ".next", "node_modules", "dist", "generated",
    "coverage", "playwright-report", "test-results",
  ]);
  const include = (source) => {
    const parts = relative(sourceRoot, source).split(sep);
    return !parts.some((part) => generatedDirectories.has(part)
      || (part.startsWith(".env") && !part.endsWith(".example")));
  };
  for (const entry of await readdir(sourceRoot)) {
    const source = join(sourceRoot, entry);
    if (include(source)) {
      await cp(source, join(destination, entry), { recursive: true, filter: include });
    }
  }
  for (const path of requiredPaths) {
    try {
      await access(join(destination, path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error(`Workspace snapshot is missing ${path}; include the cache proof inputs before running it.`);
    }
  }
  await symlink(join(sourceRoot, "node_modules"), join(destination, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}

export async function verifyCacheInputCorrection() {
  const inputPath = join(root, inputRelativePath);
  const projectPath = join(root, projectRelativePath);
  const [originalInput, originalProject] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(projectPath, "utf8"),
  ]);
  const stateDirectory = await mkdtemp(join(tmpdir(), "section-8-cache-input-"));
  const workspaceRoot = join(stateDirectory, "workspace");
  const cacheDirectory = join(stateDirectory, "cache");
  const brokenEnvironment = nxEnvironment(workspaceRoot, cacheDirectory, join(stateDirectory, "broken-workspace-data"));
  const correctedEnvironment = nxEnvironment(workspaceRoot, cacheDirectory, join(stateDirectory, "corrected-workspace-data"));

  try {
    await mkdir(workspaceRoot);
    await snapshotWorkspace(workspaceRoot, root, [
      "nx.json",
      inputRelativePath,
      projectRelativePath,
      "tests/tooling/cache-fixture/run.mjs",
    ]);
    const fixtureInputPath = join(workspaceRoot, inputRelativePath);
    const fixtureProjectPath = join(workspaceRoot, projectRelativePath);
    const committedProject = await readFile(fixtureProjectPath, "utf8");
    const brokenProject = JSON.parse(committedProject);
    brokenProject.targets["test:cache-input"].inputs = [
      "{projectRoot}/cache-fixture/**/*",
    ];
    await writeFile(fixtureProjectPath, `${JSON.stringify(brokenProject, null, 2)}\n`, "utf8");

    const initialRun = await runFixture(workspaceRoot, brokenEnvironment);
    await writeFile(fixtureInputPath, "after\n", "utf8");
    const falseHit = await runFixture(workspaceRoot, brokenEnvironment);

    await writeFile(fixtureProjectPath, committedProject, "utf8");
    await writeFile(fixtureInputPath, "corrected-before\n", "utf8");
    const correctedBaseline = await runFixture(workspaceRoot, correctedEnvironment);
    await writeFile(fixtureInputPath, "after\n", "utf8");
    const correctedRun = await runFixture(workspaceRoot, correctedEnvironment);
    const replay = await runFixture(workspaceRoot, correctedEnvironment);

    return { correctedBaseline, correctedRun, falseHit, initialRun, replay };
  } finally {
    try {
      await Promise.all([
        assertRestored(inputPath, originalInput),
        assertRestored(projectPath, originalProject),
      ]);
    } finally {
      await rm(stateDirectory, { force: true, recursive: true });
    }
  }
}
