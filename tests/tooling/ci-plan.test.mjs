import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const plannerUrl = new URL('../../scripts/ci-plan.mjs', import.meta.url);
const ready = existsSync(plannerUrl);
const p = '@madeup-video/';
const required = ['storefront:test:integration', 'api-e2e:test', 'storefront:test:e2e', 'admin-e2e:test', 'repository-tooling:test:tooling'].map(x => p+x);

test('CI planner exists to select actual executable targets', () => assert.ok(ready, 'Missing scripts/ci-plan.mjs'));
for (const [file, targets] of [
  ['libs/rental-domain/src/index.ts', required],
  ['libs/contracts/src/index.ts', required],
  ['apps/api/src/main.ts', required],
  ['prisma/schema.prisma', required],
  ['nx.json', required],
]) {
  test(`selects required exact suite targets for ${file}`, { skip: !ready }, async () => {
    const { createPlan } = await import(plannerUrl);
    const plan = await createPlan({ files: [file] });
    for (const target of targets) assert.ok(plan.tasks.includes(target), `${file} omitted ${target}`);
    assert.ok(plan.global.includes('lint'));
    assert.equal(new Set(plan.tasks).size, plan.tasks.length);
    assert.ok(!plan.tasks.some(x => x.endsWith(':e2e') && !x.endsWith(':test:e2e')));
    if (file.startsWith('prisma/')) assert.ok(plan.tasks.includes(p+'api:build'), 'schema must rebuild API');
    if (file === 'nx.json') assert.equal(plan.full, true);
  });
}
test('UI leaf avoids API validation while preserving both browsers and global checks', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  const plan = await createPlan({ files: ['libs/ui/src/index.ts'] });
  assert.ok(plan.tasks.includes(p+'storefront:test:e2e'));
  assert.ok(plan.tasks.includes(p+'admin-e2e:test'));
  assert.ok(!plan.tasks.includes(p+'api-e2e:test'));
  assert.ok(!plan.tasks.includes(p+'api:build'));
  assert.ok(plan.tasks.includes(p+'repository-tooling:test:tooling'));
});
test('empty legitimate change retains global gates; unknown/global files force full validation', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  const empty = await createPlan({ files: [] });
  assert.deepEqual(empty.tasks, [p+'repository-tooling:test:tooling']);
  for (const file of ['scripts/dev.mjs','vitest.config.ts','package.json','new-root-config.mjs','tests/integration/database.test.ts']) {
    const plan = await createPlan({ files: [file] });
    assert.equal(plan.full, true, file);
    for (const target of required) assert.ok(plan.tasks.includes(target), target);
  }
});
test('rejects invalid file paths rather than treating them as no impact', { skip: !ready }, async () => {
  const { createPlan } = await import(plannerUrl);
  for (const files of [['../outside'], ['/absolute'], [''], ['foo\nbar']]) {
    await assert.rejects(createPlan({ files }), /path|file/i);
  }
});

test('planner CLI executes in a path with spaces and rejects a plan missing global gates', async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const {mkdtemp,writeFile,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const exec = promisify(execFile);
  const cli=fileURLToPath(plannerUrl);
  const result=await exec(process.execPath,[cli,'--files','libs/ui/src/index.ts']);
  const plan=JSON.parse(result.stdout);
  assert.ok(plan.tasks.includes(p+'storefront:test:unit'));
  const dir=await mkdtemp(join(tmpdir(),'s09-invalid-plan-'));
  try {
    const file=join(dir,'plan.json');
    await writeFile(file,JSON.stringify({global:[],tasks:[]}));
    await assert.rejects(exec(process.execPath,[cli,'--run','--plan',file]),/required|global|tooling/i);
  } finally {await rm(dir,{recursive:true,force:true});}
});
