import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('CI uses explicit head/full history and preserves all prerequisite boundaries', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  for (const required of ['fetch-depth: 0','pull_request.head.sha','ci-base.mjs','ci-plan.mjs','--frozen-lockfile','24.18.0','11.17.0','madeup_video_test','createdb','--with-deps chromium','db:generate','NX_NO_CLOUD','NX_DAEMON','NX_PREFER_NODE_STRIP_TYPES','actions: read','LAST_SUCCESSFUL_SHA']) assert.ok(source.includes(required),required);
  assert.ok(!source.includes('pull_request_target'));
});

test('runner paths are initialized on the runner and PR head does not override reserved GitHub variables', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  const jobEnvironment = source.split('    env:')[1].split('    services:')[0];
  assert.doesNotMatch(jobEnvironment,/\$\{\{\s*runner\./);
  assert.match(source,/NX_CACHE_DIRECTORY=\$RUNNER_TEMP/);
  assert.match(source,/CI_EVENT_HEAD: \$\{\{ github.event.pull_request.head.sha/);
});
