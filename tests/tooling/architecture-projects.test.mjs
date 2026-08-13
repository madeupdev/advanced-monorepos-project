import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const courseTags = new Map([
  ['@madeup-video/storefront', ['runtime:universal', 'scope:storefront', 'type:app']],
  ['@madeup-video/contracts', ['runtime:universal', 'scope:rental', 'type:contract']],
  ['@madeup-video/rental-domain', ['runtime:universal', 'scope:rental', 'type:domain']],
  ['@madeup-video/database', ['runtime:server', 'scope:rental', 'type:data-access']],
  ['@madeup-video/ui', ['runtime:browser', 'scope:shared', 'type:ui']],
  ['@madeup-video/testing', ['runtime:server', 'scope:shared', 'type:test']],
]);

test('models only the storefront and five approved libraries', async () => {
  const { stdout } = await exec('pnpm', ['exec', 'nx', 'show', 'projects', '--json'], {
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

test('locates the storefront at its canonical application root', async () => {
  const { stdout } = await exec(
    'pnpm',
    ['exec', 'nx', 'show', 'project', '@madeup-video/storefront', '--json'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(JSON.parse(stdout).root, 'apps/storefront');
});

test('preserves the accepted storefront dependency edges', async () => {
  const { stdout } = await exec(
    'pnpm',
    ['exec', 'nx', 'graph', '--file=stdout'],
    { cwd: root, encoding: 'utf8' },
  );
  const graph = JSON.parse(stdout).graph;

  assert.deepEqual(
    graph.dependencies['@madeup-video/storefront']
      .map(({ target }) => target)
      .sort(),
    [
      '@madeup-video/contracts',
      '@madeup-video/database',
      '@madeup-video/rental-domain',
      '@madeup-video/testing',
      '@madeup-video/ui',
    ],
  );
});

test('exposes only the five approved library entry points', async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL('../../tsconfig.base.json', import.meta.url)),
  );

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

test('classifies each project by purpose, runtime, and scope', async () => {
  for (const [projectName, expectedTags] of courseTags) {
    const { stdout } = await exec(
      'pnpm',
      ['exec', 'nx', 'show', 'project', projectName, '--json'],
      { cwd: root, encoding: 'utf8' },
    );
    const project = JSON.parse(stdout);
    const controlledTags = project.tags
      .filter((tag) => !tag.startsWith('npm:'))
      .sort();

    assert.deepEqual(controlledTags, expectedTags, projectName);
  }
});
