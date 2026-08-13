import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  auditBundle,
  compareBundleDirectories,
  expectedBundleNames,
} from '../../tools/course-recovery/bundle.mjs';

const state = {
  id: 'S01-L01-start',
  sourceCommit: 'a'.repeat(40),
  asset: 'S01-L01-start.tar.gz',
  sha256: 'PENDING',
};

function register(overrides = {}) {
  return {
    schemaVersion: 1,
    courseVersion: '1.0.0',
    release: {
      repository: 'https://github.com/madeupdev/advanced-monorepos-project',
      tag: 'course-v1.0.0',
      maxAssetBytes: 1024,
    },
    states: [state],
    ...overrides,
  };
}

async function createBundle(contents = 'archive bytes') {
  const directory = await mkdtemp(join(tmpdir(), 'course-bundle-'));
  const bytes = Buffer.from(contents);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, state.asset), bytes);
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    courseVersion: '1.0.0',
    release: {
      repository: 'https://github.com/madeupdev/advanced-monorepos-project',
      tag: 'course-v1.0.0',
    },
    assets: [{ ...state, size: bytes.length, sha256 }],
  }, null, 2)}\n`);
  await writeFile(join(directory, 'SHA256SUMS'), `${sha256}  ${state.asset}\n`);
  return { directory, sha256 };
}

test('requires only every registered archive, manifest, and sums', () => {
  assert.deepEqual(expectedBundleNames(register()), [
    'S01-L01-start.tar.gz',
    'manifest.json',
    'SHA256SUMS',
  ]);
});

test('independently verifies manifest sizes, digests, and SHA256SUMS', async () => {
  const fixture = await createBundle();
  const result = await auditBundle(fixture.directory, register());
  assert.equal(result.assets[0].sha256, fixture.sha256);
  assert.equal(result.assets[0].size, Buffer.byteLength('archive bytes'));
});

test('rejects an archive digest that differs from the authoritative register', async () => {
  const fixture = await createBundle();
  await assert.rejects(
    auditBundle(fixture.directory, register({
      states: [{ ...state, sha256: '0'.repeat(64) }],
    })),
    /register.*SHA-256|SHA-256.*register/i,
  );
});

for (const [label, mutate, pattern] of [
  ['missing asset', async ({ directory }) => rm(join(directory, state.asset)), /missing/i],
  ['unexpected asset', async ({ directory }) => writeFile(join(directory, 'extra.log'), 'x'), /unexpected/i],
  ['byte mismatch', async ({ directory }) => writeFile(join(directory, state.asset), 'changed'), /size|SHA-256/i],
  ['modeled size mismatch', async ({ directory }) => {
    const path = join(directory, 'manifest.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.assets[0].size += 1;
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }, /size/i],
  ['modeled digest mismatch', async ({ directory }) => {
    const path = join(directory, 'manifest.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.assets[0].sha256 = '0'.repeat(64);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }, /SHA-256/i],
]) {
  test(`rejects a bundle with ${label}`, async () => {
    const fixture = await createBundle();
    await mutate(fixture);
    await assert.rejects(auditBundle(fixture.directory, register()), pattern);
  });
}

test('rejects duplicate or portable-colliding state IDs and assets', () => {
  assert.throws(
    () => expectedBundleNames(register({ states: [
      state,
      { ...state, id: state.id.toLowerCase(), asset: state.asset.toLowerCase() },
    ] })),
    /duplicate|collision/i,
  );
});

test('rejects archives larger than the registered maximum', async () => {
  const fixture = await createBundle('large archive');
  await assert.rejects(
    auditBundle(fixture.directory, register({
      release: { ...register().release, maxAssetBytes: 2 },
    })),
    /maxAssetBytes/i,
  );
});

test('rejects nondeterministic second-build bytes', async () => {
  const first = await createBundle();
  const second = await createBundle();
  await mkdir(second.directory, { recursive: true });
  await writeFile(join(second.directory, state.asset), 'nondeterministic');
  await assert.rejects(
    compareBundleDirectories(
      first.directory,
      second.directory,
      expectedBundleNames(register()),
    ),
    /not byte-identical.*S01-L01-start\.tar\.gz/i,
  );
});
