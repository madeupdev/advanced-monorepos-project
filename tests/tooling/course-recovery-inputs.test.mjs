import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertCommitReachable,
  validateRehearsalInputs,
  verifyFileSha256,
} from '../../tools/course-recovery/inputs.mjs';

const validInputs = {
  courseVersion: '1.0.0',
  authoringCommit: 'a'.repeat(40),
  cliVersion: '0.1.0',
  cliTag: 'v0.1.0',
  cliSha256: 'b'.repeat(64),
};

test('derives the immutable CLI asset from validated version and fixed repository', () => {
  assert.deepEqual(validateRehearsalInputs(validInputs), {
    ...validInputs,
    assetName: 'madeup-video-course-0.1.0.tgz',
    assetUrl:
      'https://github.com/madeupdev/madeup-video-course-cli/releases/download/v0.1.0/madeup-video-course-0.1.0.tgz',
  });
});

for (const [field, value] of [
  ['courseVersion', '^1.0.0'],
  ['courseVersion', '01.0.0'],
  ['authoringCommit', 'abc123'],
  ['authoringCommit', 'A'.repeat(40)],
  ['cliVersion', 'latest'],
  ['cliTag', 'v0.1'],
  ['cliSha256', 'B'.repeat(64)],
  ['cliSha256', 'short'],
]) {
  test(`rejects malformed exact input ${field}=${value}`, () => {
    assert.throws(
      () => validateRehearsalInputs({ ...validInputs, [field]: value }),
      new RegExp(field, 'i'),
    );
  });
}

test('rejects a CLI tag that does not identify the exact CLI version', () => {
  assert.throws(
    () => validateRehearsalInputs({ ...validInputs, cliTag: 'v0.1.1' }),
    /cliTag.*v0\.1\.0/i,
  );
});

test('does not accept or copy an arbitrary CLI URL input', () => {
  assert.throws(
    () => validateRehearsalInputs({
      ...validInputs,
      cliUrl: 'https://attacker.invalid/course.tgz',
    }),
    /unknown.*cliUrl/i,
  );
});

test('fails closed when the downloaded CLI digest differs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'course-recovery-input-'));
  const path = join(directory, 'course.tgz');
  await writeFile(path, 'trusted bytes');
  await assert.rejects(
    verifyFileSha256(path, '0'.repeat(64)),
    /CLI tarball SHA-256 mismatch/,
  );
  await assert.doesNotReject(
    verifyFileSha256(
      path,
      createHash('sha256').update('trusted bytes').digest('hex'),
    ),
  );
});

test('rejects an authoring commit not reachable from fetched origin/main', async () => {
  const calls = [];
  await assert.rejects(
    assertCommitReachable({
      repository: '/fixed/authoring',
      commit: 'a'.repeat(40),
      ref: 'origin/main',
      label: 'Authoring commit',
      git: async (...args) => {
        calls.push(args);
        return { exitCode: 1, stderr: 'not an ancestor' };
      },
    }),
    /Authoring commit.*origin\/main/,
  );
  assert.deepEqual(calls, [[
    '/fixed/authoring',
    ['merge-base', '--is-ancestor', 'a'.repeat(40), 'origin/main'],
  ]]);
});

test('rejects a registered project commit not reachable from canonical origin/main', async () => {
  await assert.rejects(
    assertCommitReachable({
      repository: '/fixed/project',
      commit: 'c'.repeat(40),
      ref: 'origin/main',
      label: 'Registered project commit',
      git: async () => ({ exitCode: 128, stderr: 'missing commit' }),
    }),
    /Registered project commit.*origin\/main/,
  );
});
