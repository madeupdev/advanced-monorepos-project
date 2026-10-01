import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('CI uses explicit head/full history and preserves all prerequisite boundaries', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  for (const required of ['fetch-depth: 0','pull_request.head.sha','ci-base.mjs','ci-plan.mjs','--frozen-lockfile','24.18.0','11.17.0','madeup_video_test','createdb','--with-deps chromium','db:generate','NX_NO_CLOUD','NX_DAEMON','NX_PREFER_NODE_STRIP_TYPES','actions: read','LAST_SUCCESSFUL_SHA']) assert.ok(source.includes(required),required);
  assert.ok(!source.includes('pull_request_target'));
});

test('retention requires a secret audit and records useful execution diagnostics', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  for (const required of ['ci-artifacts.mjs','steps.audit.outcome','actions/upload-artifact@v7','retention-days: 5','ci-results/','test-results/','playwright-report/']) assert.ok(source.includes(required),required);
});

test('both browser suites retain failure traces and screenshots without overwriting each other', async () => {
  const admin = await readFile(new URL('../../apps/admin-e2e/playwright.config.ts',import.meta.url),'utf8');
  const storefront = await readFile(new URL('../../apps/storefront/playwright.config.ts',import.meta.url),'utf8');
  for (const config of [admin,storefront]) {
    assert.match(config,/trace:\s*["']retain-on-failure/);
    assert.match(config,/screenshot:\s*["']only-on-failure/);
  }
  assert.match(admin,/test-results\/admin/);
  assert.match(admin,/playwright-report\/admin/);
});
