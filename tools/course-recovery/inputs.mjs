import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INPUT_FIELDS = new Set([
  'courseVersion',
  'authoringCommit',
  'cliVersion',
  'cliTag',
  'cliSha256',
]);
const CLI_RELEASE_BASE =
  'https://github.com/madeupdev/madeup-video-course-cli/releases/download';

function requirePattern(value, pattern, name, description) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${name} must be ${description}`);
  }
}

export function validateRehearsalInputs(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Rehearsal inputs must be an object');
  }
  for (const field of Object.keys(input)) {
    if (!INPUT_FIELDS.has(field)) throw new Error(`Unknown rehearsal input ${field}`);
  }
  for (const field of INPUT_FIELDS) {
    if (!(field in input)) throw new Error(`${field} is required`);
  }
  requirePattern(
    input.courseVersion,
    SEMVER,
    'courseVersion',
    'an exact semantic version',
  );
  requirePattern(
    input.authoringCommit,
    COMMIT,
    'authoringCommit',
    'exactly 40 lowercase hexadecimal characters',
  );
  requirePattern(
    input.cliVersion,
    SEMVER,
    'cliVersion',
    'an exact semantic version',
  );
  if (input.cliTag !== `v${input.cliVersion}`) {
    throw new Error(`cliTag must equal v${input.cliVersion}`);
  }
  requirePattern(
    input.cliSha256,
    SHA256,
    'cliSha256',
    'exactly 64 lowercase hexadecimal characters',
  );
  const assetName = `madeup-video-course-${input.cliVersion}.tgz`;
  return {
    ...input,
    assetName,
    assetUrl: `${CLI_RELEASE_BASE}/${input.cliTag}/${assetName}`,
  };
}

export async function verifyFileSha256(path, expected) {
  requirePattern(
    expected,
    SHA256,
    'expected SHA-256',
    'exactly 64 lowercase hexadecimal characters',
  );
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  if (actual !== expected) {
    throw new Error(`CLI tarball SHA-256 mismatch: expected ${expected}; received ${actual}`);
  }
  return actual;
}

export async function assertCommitReachable({
  repository,
  commit,
  ref,
  label,
  git,
}) {
  const result = await git(repository, [
    'merge-base',
    '--is-ancestor',
    commit,
    ref,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`${label} ${commit} must be reachable from ${ref}`);
  }
}
