import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const nxCli = fileURLToPath(
  new URL("../../node_modules/nx/dist/bin/nx.js", import.meta.url),
);

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
    TEST_DATABASE_URL: "postgresql://course:course@127.0.0.1:5432/madeup_video_test",
  };
}

async function runNx(args, environment) {
  return exec(process.execPath, [nxCli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
}

/**
 * Asks Nx to model a changed file without mutating the tracked input. The
 * --files argument supplies the hypothetical change for both graph queries.
 */
export async function inspectAffectedSelection(relativePath) {
  const absolutePath = join(root, relativePath);
  await readFile(absolutePath);
  const stateDirectory = await mkdtemp(join(tmpdir(), "section-8-affected-"));
  const environment = nxEnvironment(stateDirectory);

  try {
    const { stdout: projectsJson } = await runNx([
      "show",
      "projects",
      "--affected",
      `--files=${relative(root, absolutePath)}`,
      "--json",
    ], environment);
    const taskGraphPath = join(stateDirectory, "unit-task-graph.json");
    await runNx([
      "run-many",
      "--target=test:unit",
      "--affected",
      `--files=${relative(root, absolutePath)}`,
      `--graph=${taskGraphPath}`,
    ], environment);
    const taskGraph = JSON.parse(await readFile(taskGraphPath, "utf8"));

    return {
      projects: JSON.parse(projectsJson).sort(),
      tasks: Object.keys(taskGraph.graph?.tasks?.tasks ?? taskGraph.tasks?.tasks ?? {}).sort(),
    };
  } finally {
    await rm(stateDirectory, { force: true, recursive: true });
  }
}
