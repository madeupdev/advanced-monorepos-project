import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  deriveArchiveLimits,
  inspectAndExtractArchive,
  verifyExtractedTree,
} from '../../tools/course-recovery/archive.mjs';
import { createTarGzip } from '../fixtures/course-recovery/tar.mjs';

async function writeArchive(entries) {
  const root = await mkdtemp(join(tmpdir(), 'course-archive-'));
  const archivePath = join(root, 'state.tar.gz');
  await writeFile(archivePath, await createTarGzip(entries));
  return { archivePath, destination: join(root, 'extracted'), root };
}

for (const [label, entry, pattern] of [
  ['traversal', { name: '../outside.txt', contents: 'x' }, /traversal|unsafe|relative/i],
  ['absolute path', { name: '/absolute.txt', contents: 'x' }, /absolute|unsafe/i],
  ['Windows absolute path', { name: 'C:/absolute.txt', contents: 'x' }, /absolute|unsafe/i],
  ['symbolic link', { name: 'link', type: 'symlink', linkname: 'target' }, /link|special/i],
  ['hard link', { name: 'link', type: 'link', linkname: 'target' }, /link|special/i],
  ['special entry', { name: 'device', type: 'character-device' }, /special|unsupported/i],
  ['Windows reserved basename', { name: 'CON', contents: 'x' }, /reserved|portable/i],
  ['Windows reserved basename with extension', { name: 'docs/LPT1.txt', contents: 'x' }, /reserved|portable/i],
  ['trailing dot', { name: 'docs/trailing.', contents: 'x' }, /trailing|portable/i],
  ['trailing space', { name: 'docs/trailing ', contents: 'x' }, /trailing|portable/i],
]) {
  test(`rejects archive ${label}`, async () => {
    const fixture = await writeArchive([entry]);
    await assert.rejects(inspectAndExtractArchive(fixture), pattern);
  });
}

test('rejects duplicate and portable-colliding archive paths', async () => {
  for (const entries of [
    [{ name: 'same.txt' }, { name: 'same.txt' }],
    [{ name: 'File.txt' }, { name: 'file.txt' }],
  ]) {
    const fixture = await writeArchive(entries);
    await assert.rejects(
      inspectAndExtractArchive(fixture),
      /duplicate|collision/i,
    );
  }
});

for (const [label, entries, limits, pattern] of [
  [
    'entry-count overflow',
    [{ name: 'one' }, { name: 'two' }, { name: 'three' }],
    { maxEntries: 2, maxEntryBytes: 16, maxTotalBytes: 32 },
    /entry count.*limit/i,
  ],
  [
    'per-entry decompression overflow',
    [{ name: 'large.txt', contents: 'x'.repeat(100_000) }],
    { maxEntries: 2, maxEntryBytes: 128, maxTotalBytes: 256 },
    /entry.*size.*limit/i,
  ],
  [
    'total decompression overflow',
    [
      { name: 'one.txt', contents: 'x'.repeat(12) },
      { name: 'two.txt', contents: 'x'.repeat(12) },
    ],
    { maxEntries: 2, maxEntryBytes: 16, maxTotalBytes: 20 },
    /total.*size.*limit/i,
  ],
]) {
  test(`rejects archive ${label} while streaming`, async () => {
    const fixture = await writeArchive(entries);
    await assert.rejects(
      inspectAndExtractArchive({ ...fixture, limits }),
      pattern,
    );
    await assert.rejects(stat(fixture.destination), { code: 'ENOENT' });
  });
}

async function gitFixture() {
  const repository = await mkdtemp(join(tmpdir(), 'course-tree-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repository });
  await mkdir(join(repository, 'bin'));
  await writeFile(join(repository, 'README.md'), 'expected\n');
  await writeFile(join(repository, 'bin/run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', [
    '-c', 'user.name=Recovery Test',
    '-c', 'user.email=recovery@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', 'fixture',
  ], { cwd: repository });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();
  const archive = await writeArchive([
    { name: 'bin/', type: 'directory', mode: 0o755 },
    { name: 'README.md', contents: 'expected\n', mode: 0o644 },
    { name: 'bin/run.sh', contents: '#!/bin/sh\n', mode: 0o755 },
  ]);
  await inspectAndExtractArchive(archive);
  return { ...archive, repository, commit };
}

test('derives exact archive resource limits from the expected Git tree', async () => {
  const fixture = await gitFixture();
  assert.deepEqual(
    await deriveArchiveLimits({
      repository: fixture.repository,
      commit: fixture.commit,
    }),
    {
      maxEntries: 3,
      maxEntryBytes: 10,
      maxTotalBytes: 19,
      maxArchiveBytes: 3584,
    },
  );
});

test('rejects total decompressed tar-stream overflow before retaining entries', async () => {
  const fixture = await writeArchive([
    { name: 'small.txt', contents: 'x' },
  ]);
  await assert.rejects(
    inspectAndExtractArchive({
      ...fixture,
      limits: {
        maxEntries: 1,
        maxEntryBytes: 1,
        maxTotalBytes: 1,
        maxArchiveBytes: 128,
      },
    }),
    /decompressed archive.*limit/i,
  );
  await assert.rejects(stat(fixture.destination), { code: 'ENOENT' });
});

test('accepts an extracted tree matching the exact Git commit', async () => {
  const fixture = await gitFixture();
  const result = await verifyExtractedTree(fixture);
  assert.deepEqual(result.files.map(({ path, mode }) => ({ path, mode })), [
    { path: 'README.md', mode: 0o644 },
    { path: 'bin/run.sh', mode: 0o755 },
  ]);
});

for (const [label, mutate, pattern] of [
  ['extra file', ({ destination }) => writeFile(join(destination, 'extra.txt'), 'x'), /extra/i],
  ['missing file', ({ destination }) => import('node:fs/promises').then(({ rm }) => rm(join(destination, 'README.md'))), /missing/i],
  ['byte mismatch', ({ destination }) => writeFile(join(destination, 'README.md'), 'changed\n'), /byte|SHA-256/i],
  ['mode mismatch', ({ destination }) => chmod(join(destination, 'bin/run.sh'), 0o644), /mode/i],
]) {
  test(`rejects extracted tree ${label}`, async () => {
    const fixture = await gitFixture();
    await mutate(fixture);
    await assert.rejects(verifyExtractedTree(fixture), pattern);
  });
}

test('does not leave an outside traversal file', async () => {
  const fixture = await writeArchive([{ name: '../outside.txt', contents: 'x' }]);
  await assert.rejects(inspectAndExtractArchive(fixture));
  await assert.rejects(readFile(join(fixture.root, 'outside.txt')));
});

test('removes a partially extracted directory after a write failure', async () => {
  const fixture = await writeArchive([
    { name: 'conflict', contents: 'file first' },
    { name: 'conflict/child.txt', contents: 'cannot create parent directory' },
  ]);
  await assert.rejects(inspectAndExtractArchive(fixture), /directory|ENOTDIR|EEXIST/i);
  await assert.rejects(stat(fixture.destination), { code: 'ENOENT' });
});
