import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const root = new URL('../../', import.meta.url);
const paths = ['apps/storefront','apps/admin','apps/api','apps/api-e2e','apps/admin-e2e','libs/contracts','libs/rental-domain','libs/database','libs/ui','libs/testing','tests/tooling'];
test('every actual project has verified review ownership and documented responsibility', async () => {
  const rules = await readFile(new URL('.github/CODEOWNERS',root),'utf8');
  const doc = await readFile(new URL('docs/architecture/ownership.md',root),'utf8');
  for (const path of paths) {
    const p = JSON.parse(await readFile(new URL(`${path}/project.json`,root),'utf8'));
    assert.deepEqual(p.metadata?.owners, ['madeupdev'], path);
    assert.ok(rules.split('\n').includes(`/${path}/ @madeupdev`), path);
    assert.ok(doc.includes(p.name), p.name);
  }
  for (const path of ['.github','scripts','tools','prisma']) assert.ok(rules.includes(`/${path}/ @madeupdev`));
  assert.ok(rules.split('\n').includes('* @madeupdev'));
  assert.match(doc, /branch protection/i);
  assert.match(doc, /PosterArt/);
  assert.match(doc, /runtime.*dependency.*public contract.*ownership.*task/i);
});
