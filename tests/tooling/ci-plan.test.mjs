import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const plannerUrl = new URL('../../scripts/ci-plan.mjs', import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const nxCli = join(root, 'node_modules/nx/dist/bin/nx.js');
const exec = promisify(execFile);
const ready = existsSync(plannerUrl);
const p = '@madeup-video/';
const required = ['storefront:test:integration', 'api-e2e:test', 'storefront:test:e2e', 'admin-e2e:test', 'repository-tooling:test:tooling'].map(x => p+x);

async function createDisposableWorkspace() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'ci-plan-library-'));
  const listing = (await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root })).stdout;
  for (const file of listing.split('\0').filter(Boolean)) {
    const source = join(root, file);
    const destination = join(directory, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  }
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return directory;
}

function fixtureEnvironment(directory) {
  return {
    ...process.env,
    NX_DAEMON: 'false',
    NX_NO_CLOUD: 'true',
    NX_TUI: 'false',
    NX_INTERACTIVE: 'false',
    NX_PREFER_NODE_STRIP_TYPES: 'false',
    NODE_PATH: [
      join(root, 'node_modules/nx/node_modules'),
      join(root, 'node_modules'),
      join(root, 'node_modules/.pnpm/node_modules'),
      process.env.NODE_PATH,
    ].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    NX_CACHE_DIRECTORY: join(directory, '.nx', 'cache'),
    NX_WORKSPACE_DATA_DIRECTORY: join(directory, '.nx', 'workspace-data'),
    TEST_DATABASE_URL: 'postgresql://ci-plan:ci-plan@127.0.0.1:5432/ci_plan_test',
    pnpm_config_verify_deps_before_run: 'false',
  };
}

test('CI planner exists to select actual executable targets', () => assert.ok(ready, 'Missing scripts/ci-plan.mjs'));
test('serialized plans accept generated library test targets while retaining required gates', async () => {
  const { readPlan } = await import(plannerUrl);
  const plan = readPlan(JSON.stringify({
    global: ['lint'],
    tasks: [p + 'repository-tooling:test:tooling', p + 'ci-proof:test'],
  }));
  assert.deepEqual(plan.tasks, [p + 'repository-tooling:test:tooling', p + 'ci-proof:test']);
  assert.throws(() => readPlan(JSON.stringify({
    global: ['lint'],
    tasks: [p + 'repository-tooling:test:tooling', p + 'ci-proof:unsupported'],
  })), /unsupported target/i);
});
for (const [file, targets] of [
  ['libs/rental-domain/src/index.ts', required],
  ['libs/contracts/src/index.ts', required],
  ['apps/api/src/main.ts', required],
  ['prisma/schema.prisma', required],
  ['nx.json', required],
]) {
  test(`selects required exact suite targets for ${file}`, { skip: !ready }, async () => {
    const { createPlan } = await import(plannerUrl);
    const plan = await createPlan({ files: [file] });
    for (const target of targets) assert.ok(plan.tasks.includes(target), `${file} omitted ${target}`);
    assert.ok(plan.global.includes('lint'));
    assert.equal(new Set(plan.tasks).size, plan.tasks.length);
    assert.ok(!plan.tasks.some(x => x.endsWith(':e2e') && !x.endsWith(':test:e2e')));
    if (file.startsWith('prisma/')) assert.ok(plan.tasks.includes(p+'api:build'), 'schema must rebuild API');
    if (file === 'nx.json') assert.equal(plan.full, true);
  });
}
test('UI leaf avoids API validation while preserving both browsers and global checks', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  const plan = await createPlan({ files: ['libs/ui/src/index.ts'] });
  assert.ok(plan.tasks.includes(p+'storefront:test:e2e'));
  assert.ok(plan.tasks.includes(p+'admin-e2e:test'));
  assert.ok(!plan.tasks.includes(p+'api-e2e:test'));
  assert.ok(!plan.tasks.includes(p+'api:build'));
  assert.ok(plan.tasks.includes(p+'repository-tooling:test:tooling'));
});
test('empty legitimate change retains global gates; unknown/global files force full validation', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  const empty = await createPlan({ files: [] });
  assert.deepEqual(empty.tasks, [p+'repository-tooling:test:tooling']);
  for (const file of ['scripts/dev.mjs','vitest.config.ts','package.json','new-root-config.mjs','tests/integration/database.test.ts']) {
    const plan = await createPlan({ files: [file] });
    assert.equal(plan.full, true, file);
    for (const target of required) assert.ok(plan.tasks.includes(target), target);
  }
});
test('rejects invalid file paths rather than treating them as no impact', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  for (const files of [['../outside'], ['/absolute'], [''], ['foo\nbar']]) {
    await assert.rejects(createPlan({ files }), /path|file/i);
  }
});

test('planner CLI executes in a path with spaces and rejects a plan missing global gates', async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const {mkdtemp,writeFile,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const exec = promisify(execFile);
  const cli=fileURLToPath(plannerUrl);
  const result=await exec(process.execPath,[cli,'--files','libs/ui/src/index.ts']);
  const plan=JSON.parse(result.stdout);
  assert.ok(plan.tasks.includes(p+'storefront:test:unit'));
  const dir=await mkdtemp(join(tmpdir(),'s09-invalid-plan-'));
  try {
    const file=join(dir,'plan.json');
    await writeFile(file,JSON.stringify({global:[],tasks:[]}));
    await assert.rejects(exec(process.execPath,[cli,'--run','--plan',file]),/required|global|tooling/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('generated source-library tests are selected by impact/full plans and run from the root entry', { concurrency: false }, async () => {
  const directory = await createDisposableWorkspace();
  const env = fixtureEnvironment(directory);
  const runnerEnv = { ...env, NODE_TEST_CONTEXT: undefined };
  const collection = join(directory, 'tools', 'generators.json');
  const project = '@madeup-video/ci-proof';
  try {
    await exec(process.execPath, [nxCli, 'g', `${collection}:library`, '--name=ci-proof', '--type=domain', '--runtime=universal', '--scope=shared', '--owner=robdonn', '--interactive=false'], { cwd: directory, env });
    const { createPlan } = await import(plannerUrl);
    const affected = await createPlan({ cwd: directory, files: ['libs/ci-proof/src/index.ts'] });
    assert.ok(affected.tasks.includes(`${project}:test`), 'affected plan omitted generated library test');
    const unrelated = await createPlan({ cwd: directory, files: ['libs/ui/src/index.ts'] });
    assert.ok(!unrelated.tasks.includes(`${project}:test`), 'unrelated leaf selected generated library test');
    const full = await createPlan({ cwd: directory, files: [], full: true });
    assert.ok(full.tasks.includes(`${project}:test`), 'full plan omitted generated library test');

    const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['test:source-libraries'], 'node scripts/ci-plan.mjs --library-tests');
    const libraryTestCommand = [process.execPath, join(directory, 'scripts', 'ci-plan.mjs'), '--library-tests'];
    const passing = await exec(libraryTestCommand[0], libraryTestCommand.slice(1), { cwd: directory, env: runnerEnv });
    assert.match(`${passing.stdout}\n${passing.stderr}`, /@madeup-video\/ci-proof:test/);

    const sourceFile = join(directory, 'libs', 'ci-proof', 'src', 'lib', 'ci-proof.ts');
    const source = await readFile(sourceFile, 'utf8');
    const broken = source.replace('return value;', 'return undefined;');
    assert.notEqual(broken, source, 'generated identity implementation was not found');
    await writeFile(sourceFile, broken);
    let failure;
    try {
      await exec(libraryTestCommand[0], libraryTestCommand.slice(1), { cwd: directory, env: runnerEnv });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `broken generated source test unexpectedly passed`);
    assert.match(`${failure.stdout}\n${failure.stderr}`, /AssertionError|notStrictEqual|expected/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
