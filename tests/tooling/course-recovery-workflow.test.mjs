import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowPath = new URL(
  '../../.github/workflows/course-recovery-release.yml',
  import.meta.url,
);

async function workflow() {
  return readFile(workflowPath, 'utf8');
}

test('uses only workflow_dispatch with exact fail-closed input validation', async () => {
  const source = await workflow();
  assert.match(source, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(source, /\n\s+(?:push|pull_request|schedule|workflow_run):/);
  for (const input of [
    'course_version',
    'authoring_commit',
    'cli_version',
    'cli_tag',
    'cli_sha256',
  ]) {
    assert.match(source, new RegExp(`${input}:[\\s\\S]{0,180}required: true`));
  }
  assert.match(source, /\^\(0\|\[1-9\]\\d\*\)\\\.\(0\|\[1-9\]\\d\*\)\\\.\(0\|\[1-9\]\\d\*\)\$/);
  assert.match(source, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(source, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(source, /cliTag !== `v\$\{cliVersion\}`/);
});

test('uses the protected environment, exact main ref, and read-only permissions', async () => {
  const source = await workflow();
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(source, /contents: write|id-token: write|packages: write|actions: write/);
  assert.match(source, /environment: course-release/);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/);
});

test('pins every third-party action to an immutable full SHA', async () => {
  const source = await workflow();
  const uses = [...source.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) {
    assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, action);
  }
});

test('checks out both repositories with full history and no persisted credentials', async () => {
  const source = await workflow();
  assert.ok((source.match(/fetch-depth: 0/g) ?? []).length >= 2);
  assert.ok((source.match(/persist-credentials: false/g) ?? []).length >= 2);
  assert.match(source, /repository: madeupdev\/advanced-monorepos-course-authoring/);
  assert.match(source, /token: \$\{\{ secrets\.AUTHORING_READ_TOKEN \}\}/);
  assert.match(source, /path: authoring/);
  assert.match(source, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/);
  assert.match(source, /merge-base --is-ancestor "\$AUTHORING_COMMIT" origin\/main/);
});

test('derives the fixed CLI release asset and verifies its digest before local installation', async () => {
  const source = await workflow();
  assert.match(source, /madeup-video-course-\$\{CLI_VERSION\}\.tgz/);
  assert.match(
    source,
    /https:\/\/github\.com\/madeupdev\/madeup-video-course-cli\/releases\/download\/\$\{CLI_TAG\}\/\$\{CLI_ASSET\}/,
  );
  assert.doesNotMatch(source, /cli_(?:url|download_url)|CLI_(?:URL|DOWNLOAD_URL)/);
  const digest = source.indexOf('Verify exact CLI tarball SHA-256');
  const install = source.indexOf('Install CLI from verified local tarball');
  assert.ok(digest > 0 && install > digest);
  assert.match(source.slice(install), /pnpm --dir "\$CLI_INSTALL_DIRECTORY" add "\$CLI_TARBALL"/);
  assert.doesNotMatch(source.slice(install), /@madeup-video\/course@|npm install.*@madeup-video\/course/);
});

test('runs PostgreSQL 17 with explicit health checks and the tested rehearsal runner', async () => {
  const source = await workflow();
  assert.match(source, /image: postgres:17/);
  assert.match(source, /--health-cmd.*pg_isready/);
  assert.match(source, /--health-interval/);
  assert.match(source, /--health-timeout/);
  assert.match(source, /--health-retries/);
  assert.match(source, /node project\/tools\/course-recovery\/rehearse\.mjs/);
  assert.match(source, /project\/course\/delivery-states\.json|authoring\/course\/delivery-states\.json/);
});

test('contains no release creation, upload, publication, or mutation path', async () => {
  const source = await workflow();
  assert.doesNotMatch(
    source,
    /gh\s+release|release\s+(?:create|edit|upload)|softprops\/action-gh-release|draft=false|status[^\n]*published|publish release/i,
  );
  assert.doesNotMatch(source, /api\.github\.com|repos\/\$\{[^}]+\}\/releases/);
});

test('uploads one short-lived fixed-name artifact using only the explicit bundle allowlist', async () => {
  const source = await workflow();
  assert.equal((source.match(/actions\/upload-artifact@/g) ?? []).length, 1);
  assert.match(source, /name: course-recovery-rehearsal/);
  assert.match(source, /retention-days: 2/);
  assert.match(source, /if-no-files-found: error/);
  for (const asset of [
    'S01-L01-start.tar.gz',
    'S01-L02-start.tar.gz',
    'S01-L03-start.tar.gz',
    'S02-L01-start.tar.gz',
    'S02-L02-start.tar.gz',
    'S02-L03-start.tar.gz',
    'S02-L04-start.tar.gz',
    'S03-L01-start.tar.gz',
    'S03-L02-start.tar.gz',
    'S03-L03-start.tar.gz',
    'S03-L04-start.tar.gz',
    'manifest.json',
    'SHA256SUMS',
  ]) {
    assert.match(source, new RegExp(`course-recovery-bundle/${asset.replaceAll('.', '\\.').replaceAll('*', '\\*')}`));
  }
  const uploadStep = source.slice(source.indexOf('actions/upload-artifact@'));
  assert.doesNotMatch(
    uploadStep.split(/\n\s+- name:/, 1)[0],
    /authoring|delivery-states|node_modules|\.env|\.log|database|dump/i,
  );
});

test('never prints or stages the private register or authoring token', async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /cat .*delivery-states|jq .*delivery-states|echo .*AUTHORING_READ_TOKEN/);
  assert.doesNotMatch(source, /GITHUB_STEP_SUMMARY|::debug::/);
});
