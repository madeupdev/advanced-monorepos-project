import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));

test('models only the storefront and five approved libraries', async () => {
  const { stdout } = await exec('pnpm', ['exec', 'nx', 'show', 'projects'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.deepEqual(JSON.parse(stdout).sort(), [
    '@madeup-video/contracts',
    '@madeup-video/database',
    '@madeup-video/rental-domain',
    '@madeup-video/storefront',
    '@madeup-video/testing',
    '@madeup-video/ui',
  ]);
});

test('exposes only the five approved library entry points', async () => {
  const tsconfig = JSON.parse(await readFile(new URL('../../tsconfig.json', import.meta.url)));

  assert.deepEqual(Object.keys(tsconfig.compilerOptions.paths ?? {}).sort(), [
    '@madeup-video/contracts',
    '@madeup-video/database',
    '@madeup-video/rental-domain',
    '@madeup-video/testing',
    '@madeup-video/ui',
  ]);
  for (const [name, [entryPoint]] of Object.entries(tsconfig.compilerOptions.paths ?? {})) {
    assert.equal(entryPoint, `./libs/${name.replace('@madeup-video/', '')}/src/index.ts`);
  }
});
