import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const nxBin = path.join('node_modules', 'nx', 'dist', 'bin', 'nx.js');
const prefix = '@madeup-video/';
const requiredSuites = [
  `${prefix}storefront:test:integration`,
  `${prefix}api-e2e:test`,
  `${prefix}storefront:test:e2e`,
  `${prefix}admin-e2e:test`,
];
const toolingTarget = `${prefix}repository-tooling:test:tooling`;

function fail(message) {
  throw new Error(message);
}

function parseJson(text, description) {
  const value = text.trim();
  if (!value) fail(`Nx returned missing ${description} metadata`);
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`Nx returned invalid ${description} JSON: ${error.message}`);
  }
}

function validateFiles(files) {
  if (!Array.isArray(files)) fail('files must be an array');
  for (const file of files) {
    if (typeof file !== 'string' || !file || file.includes('\n') || file.includes('\r') || file.includes(',')) {
      fail(`Invalid file path: ${String(file)}`);
    }
    if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || file.split(/[\\/]+/).includes('..')) {
      fail(`Invalid file path: ${file}`);
    }
  }
}

function targetName(project, target) {
  return `${project}:${target}`;
}

function projectRoot(node) {
  return node?.data?.root ?? node?.root ?? '';
}

function projectSourceRoot(node) {
  return node?.data?.sourceRoot ?? node?.sourceRoot ?? '';
}

function hasTarget(node, target) {
  return Boolean(node?.data?.targets?.[target] ?? node?.targets?.[target]);
}

async function nxJson(args, env, description) {
  try {
    const result = await execFileAsync(process.execPath, [nxBin, ...args], {
      cwd: env.cwd,
      env: env.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return parseJson(result.stdout, description);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Nx returned ')) throw error;
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    fail(`Nx metadata command failed (${description}): ${detail}`);
  }
}

async function nxGraph(env) {
  try {
    await execFileAsync(process.execPath, [nxBin, 'graph', `--file=${env.graphFile}`], {
      cwd: env.cwd,
      env: env.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return parseJson(await readFile(env.graphFile, 'utf8'), 'graph');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Nx returned ')) throw error;
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    fail(`Nx metadata command failed (graph): ${detail}`);
  }
}

async function createNxEnvironment(cwd) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'ci-plan-'));
  return {
    tempRoot,
    graphFile: path.join(tempRoot, 'graph.json'),
    cwd,
    env: {
      ...process.env,
      NODE_PATH: [path.join(cwd, 'node_modules/nx/node_modules'), path.join(cwd, 'node_modules'), path.join(cwd, 'node_modules/.pnpm/node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
      NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_PREFER_NODE_STRIP_TYPES: 'false',
      NX_CACHE_DIRECTORY: path.join(tempRoot, 'cache'),
      NX_WORKSPACE_DATA_DIRECTORY: path.join(tempRoot, 'workspace-data'),
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://ci-plan:ci-plan@127.0.0.1:5432/ci_plan_test',
    },
  };
}

function graphNodes(graph) {
  const nodes = graph?.graph?.nodes ?? graph?.nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) fail('Nx graph metadata is missing nodes');
  return nodes;
}

function affectedNames(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.projects)) return value.projects;
  fail('Nx affected-project metadata is missing projects');
}

function isOwnedFile(file, nodes) {
  return Object.values(nodes).some((node) => {
    const root = projectRoot(node).replaceAll('\\', '/').replace(/\/$/, '');
    const source = projectSourceRoot(node).replaceAll('\\', '/').replace(/\/$/, '');
    return (root && (file === root || file.startsWith(`${root}/`))) || (source && (file === source || file.startsWith(`${source}/`)));
  });
}

function requiredTargetOwners(nodes) {
  for (const fullTarget of [...requiredSuites, toolingTarget]) {
    const separator = fullTarget.indexOf(':', fullTarget.indexOf('/') + 1);
    const project = fullTarget.slice(0, separator);
    const target = fullTarget.slice(separator + 1);
    const node = nodes[project];
    if (!node || !hasTarget(node, target)) fail(`Required target is missing from Nx metadata: ${fullTarget} (projects: ${Object.keys(nodes).join(',')})`);
  }
}

function selectedTargets(nodes, projects, full) {
  const names = full ? Object.keys(nodes) : projects;
  const selected = new Set(names);
  const typechecks = names.filter((name) => selected.has(name) && hasTarget(nodes[name], 'typecheck')).sort();
  const builds = names.filter((name) => selected.has(name) && hasTarget(nodes[name], 'build')).sort();
  const tasks = [toolingTarget, ...typechecks.map((name) => targetName(name, 'typecheck')), ...builds.map((name) => targetName(name, 'build'))];
  const storefront = selected.has(`${prefix}storefront`);
  const api = selected.has(`${prefix}api`);
  const database = selected.has(`${prefix}database`);
  const admin = selected.has(`${prefix}admin`);
  const apiE2e = selected.has(`${prefix}api-e2e`);
  const adminE2e = selected.has(`${prefix}admin-e2e`);
  if (storefront) tasks.push(`${prefix}storefront:test:unit`);
  if (full || storefront || api || database) tasks.push(`${prefix}storefront:test:integration`);
  if (full || api || apiE2e) tasks.push(`${prefix}api-e2e:test`);
  if (full || storefront || api) tasks.push(`${prefix}storefront:test:e2e`);
  if (full || admin || adminE2e || api) tasks.push(`${prefix}admin-e2e:test`);
  return tasks;
}

export async function createPlan({ files, full = false, cwd = process.cwd() }) {
  validateFiles(files);
  if (typeof full !== 'boolean') fail('full must be a boolean');
  const nx = await createNxEnvironment(cwd);
  try {
    const graph = await nxGraph(nx);
    const nodes = graphNodes(graph);
    requiredTargetOwners(nodes);

    let effectiveFull = full;
    let projects = [];
    if (!effectiveFull && files.length > 0) {
      const rootFile = files.some((file) => !file.startsWith('apps/') && !file.startsWith('libs/'));
      const unknownFile = files.some((file) => !isOwnedFile(file, nodes));
      effectiveFull = rootFile || unknownFile;
    }
    if (!effectiveFull && files.length > 0) {
      const affected = await nxJson(['show', 'projects', '--affected', `--files=${files.join(',')}`, '--json'], nx, 'affected projects');
      projects = affectedNames(affected).filter((name) => typeof name === 'string').sort();
      for (const project of projects) if (!nodes[project]) fail(`Nx affected metadata names missing project: ${project}`);
    }
    if (effectiveFull) projects = Object.keys(nodes).sort();
    const tasks = selectedTargets(nodes, projects, effectiveFull);
    return {
      full: effectiveFull,
      reason: effectiveFull ? (full ? 'explicit full validation' : 'root or unknown file requires full validation') : files.length ? 'affected project validation' : 'no changed files; global gates only',
      files: [...files],
      projects,
      global: ['lint'],
      tasks,
      count: 1 + tasks.length,
    };
  } finally {
    await rm(nx.tempRoot, { recursive: true, force: true });
  }
}

function parseFilesArgument(value) {
  if (value === undefined) return undefined;
  return value.split(',');
}

function readPlan(value) {
  const plan = parseJson(value, 'plan');
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.global) || !Array.isArray(plan.tasks)) fail('Plan metadata is missing global/tasks arrays');
  if (plan.global.length !== 1 || plan.global[0] !== 'lint' || !plan.tasks.includes(toolingTarget)) fail('Plan is missing required global lint/tooling gates');
  const allowedSuites = new Set([toolingTarget, `${prefix}storefront:test:unit`, ...requiredSuites]);
  for (const target of plan.tasks) {
    if (typeof target !== 'string' || (!allowedSuites.has(target) && !/^@madeup-video\/[A-Za-z0-9-]+:(typecheck|build)$/.test(target))) fail(`Plan contains unsupported target: ${target}`);
  }
  if (new Set(plan.tasks).size !== plan.tasks.length) fail('Plan contains duplicate tasks');
  return plan;
}

async function runTarget(target, cwd) {
  const command = target === 'lint' ? 'pnpm' : process.execPath;
  const args = target === 'lint' ? ['lint'] : [nxBin, 'run', target, '--output-style=static'];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Validation failed: ${target} (exit ${code})`)));
  });
}

async function cli(argv) {
  const filesIndex = argv.indexOf('--files');
  const outputIndex = argv.indexOf('--output');
  const planIndex = argv.indexOf('--plan');
  const full = argv.includes('--full') || /^(1|true|yes)$/i.test(process.env.CI_FULL || '');
  if (argv.includes('--run')) {
    if (planIndex < 0 || !argv[planIndex + 1]) fail('--run requires --plan <json>');
    const plan = readPlan(await readFile(argv[planIndex + 1], 'utf8'));
    await runTarget('lint', process.cwd());
    for (const target of plan.tasks) await runTarget(target, process.cwd());
    return;
  }
  const files = filesIndex >= 0 ? parseFilesArgument(argv[filesIndex + 1]) : undefined;
  let plan;
  if (files !== undefined) {
    plan = await createPlan({ files, full });
  } else if (full) {
    plan = await createPlan({ files: [], full: true });
  } else {
    const base = process.env.CI_BASE;
    const head = process.env.CI_HEAD;
    if (!base || !head) fail('No --files provided; CI_BASE and CI_HEAD are required');
    const result = await execFileAsync('git', ['diff', '--name-only', '-z', base, head], { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
    const changed = result.stdout.split('\0').filter(Boolean);
    plan = await createPlan({ files: changed, base, head, full: false });
  }
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  if (outputIndex >= 0 && argv[outputIndex + 1]) await writeFile(argv[outputIndex + 1], serialized);
  process.stdout.write(serialized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
