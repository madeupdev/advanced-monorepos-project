import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const nxCli = fileURLToPath(
  new URL("../../node_modules/nx/dist/bin/nx.js", import.meta.url),
);

export function assertParallelProbeOutput(output) {
  const plainOutput = stripVTControlCharacters(output);
  assert.match(plainOutput, /Successfully ran targets measure:parallel-one, measure:parallel-two/);
  assert.match(plainOutput, /Cache:\s+Skipped \(--skip-nx-cache\)/);
}
function nxEnvironment(stateDirectory) {
  const nodeSearchPaths = [
    join(root, "node_modules/nx/node_modules"),
    join(root, "node_modules"),
    join(root, "node_modules/.pnpm/node_modules"),
    process.env.NODE_PATH,
  ].filter(Boolean);

  return {
    ...process.env,
    NODE_PATH: nodeSearchPaths.join(delimiter),
    NX_CACHE_DIRECTORY: join(stateDirectory, "cache"),
    NX_DAEMON: "false",
    NX_NO_CLOUD: "true",
    NX_PREFER_NODE_STRIP_TYPES: "false",
    NX_WORKSPACE_DATA_DIRECTORY: join(stateDirectory, "workspace-data"),
    SECTION8_PARALLEL_OUTPUT_DIRECTORY: join(stateDirectory, "output"),
    TEST_DATABASE_URL: "postgresql://course:course@127.0.0.1:5432/madeup_video_test",
  };
}

async function runProbe(parallel, environment) {
  const outputDirectory = environment.SECTION8_PARALLEL_OUTPUT_DIRECTORY;
  await rm(outputDirectory, { force: true, recursive: true });
  const { stderr, stdout } = await exec(process.execPath, [
    nxCli,
    "run-many",
    "--targets=measure:parallel-one,measure:parallel-two",
    "--projects=@madeup-video/repository-tooling",
    `--parallel=${parallel}`,
    "--skip-nx-cache",
    "--outputStyle=static",
  ], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  const output = `${stdout}${stderr}`;
  const entries = await readdir(outputDirectory);
  const intervals = await Promise.all(entries.map(async (entry) => JSON.parse(
    await readFile(join(outputDirectory, entry), "utf8"),
  )));
  const ordered = intervals.sort((left, right) => left.startedAt - right.startedAt);
  const [first, second] = ordered;

  assert.equal(ordered.length, 2, "both probe tasks must record an interval");
  assertParallelProbeOutput(output);

  return {
    cacheDisabled: true,
    overlaps: first.startedAt < second.finishedAt && second.startedAt < first.finishedAt,
    taskCount: ordered.length,
  };
}

export async function measureLocalParallelism() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "section-8-parallelism-"));
  const environment = nxEnvironment(stateDirectory);

  try {
    const sequential = await runProbe(1, environment);
    const parallel = await runProbe(2, environment);
    return { parallel, sequential };
  } finally {
    await rm(stateDirectory, { force: true, recursive: true });
  }
}
