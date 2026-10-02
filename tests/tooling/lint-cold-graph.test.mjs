import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('public lint rejects a forbidden dependency with a cold execution graph', async () => {
  const work = await mkdtemp(join(tmpdir(), 'lint-cold-graph-'));
  try {
    const source = join(work, 'source');
    await mkdir(source);
    await symlink(join(root, 'node_modules'), join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await cp(join(root, 'eslint.config.mjs'), join(source, 'eslint.config.mjs'));
    const { scripts, packageManager } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await writeFile(join(source, 'package.json'), JSON.stringify({ private: true, packageManager, type: 'module', scripts: { lint: scripts.lint } }));
    await cp(join(root, 'scripts'), join(source, 'scripts'), { recursive: true });
    await writeFile(join(source, 'nx.json'), JSON.stringify({ plugins: [] }));
    await writeFile(join(source, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { paths: {
      '@madeup-video/contracts': ['./libs/contracts/src/index.ts'],
      '@madeup-video/database': ['./libs/database/src/index.ts'],
    } } }));
    for (const [name, tags] of [['contracts', ['type:contract', 'runtime:universal', 'scope:rental']], ['database', ['type:data-access', 'runtime:server', 'scope:rental']]]) {
      await mkdir(join(source, 'libs', name, 'src'), { recursive: true });
      await writeFile(join(source, 'libs', name, 'project.json'), JSON.stringify({ name: `@madeup-video/${name}`, sourceRoot: `libs/${name}/src`, projectType: 'library', tags }));
    }
    const contract = join(source, 'libs/contracts/src/index.ts');
    await writeFile(join(source, 'libs/database/src/index.ts'), 'export const database = 1;\n');
    await writeFile(contract, "export { database } from '@madeup-video/database';\n");
    const environment = { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_PREFER_NODE_STRIP_TYPES: 'false', NX_CACHE_DIRECTORY: join(work, 'cache'), NX_WORKSPACE_DATA_DIRECTORY: join(work, 'workspace'), FORCE_COLOR: '0', pnpm_config_verify_deps_before_run: 'false' };
    // Invoke the public command through corepack's pinned pnpm, without prebuilding a graph.
    const runLint = () => spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'lint', '--', 'libs/contracts/src/index.ts'], { cwd: source, env: environment, encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' });
    const rejected = runLint();
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stdout + rejected.stderr, /@nx\/enforce-module-boundaries/);
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /No cached ProjectGraph|rule will be skipped/i);
    await writeFile(contract, 'export const contract = 1;\n');
    await rm(join(work, 'workspace'), { recursive: true, force: true });
    const accepted = runLint();
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.doesNotMatch(accepted.stdout + accepted.stderr, /No cached ProjectGraph|rule will be skipped/i);
    const stdinViolation = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'lint', '--', '--stdin', '--stdin-filename', 'libs/contracts/src/index.ts'], {
      cwd: source, env: environment, encoding: 'utf8', timeout: 120_000,
      shell: process.platform === 'win32', input: "export { database } from '@madeup-video/database';\n",
    });
    assert.ifError(stdinViolation.error);
    assert.equal(stdinViolation.status, 1, stdinViolation.stdout + stdinViolation.stderr);
    assert.match(stdinViolation.stdout + stdinViolation.stderr, /@nx\/enforce-module-boundaries/);
    const uncached = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'lint', '--', 'libs/contracts/src/index.ts'], {
      cwd: source, env: { ...environment, NX_CACHE_PROJECT_GRAPH: 'false', NX_WORKSPACE_DATA_DIRECTORY: join(work, 'uncached-workspace') },
      encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32',
    });
    assert.ifError(uncached.error);
    assert.equal(uncached.status, 1, uncached.stdout + uncached.stderr);
    assert.match(uncached.stdout + uncached.stderr, /refusing a passing result/);
    await writeFile(join(source, 'nx.json'), '{ invalid JSON');
    const unavailable = runLint();
    assert.ifError(unavailable.error);
    assert.notEqual(unavailable.status, 0);
    assert.match(unavailable.stdout + unavailable.stderr, /Cannot initialize the Nx graph/);
    assert.doesNotMatch(unavailable.stdout + unavailable.stderr, /Nx graph initialized/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
