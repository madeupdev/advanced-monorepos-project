import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
let plan;
test('scoped upgrade planner exists',async()=>{assert.ok(existsSync(new URL('../../scripts/upgrade-plan.mjs',import.meta.url)),'missing scoped upgrade planner');({planUpgrade:plan}=await import('../../scripts/upgrade-plan.mjs'));});
test('takes reverse-transitive impact while retaining unrelated projects',()=>{
 const graph={nodes:{contracts:{data:{targets:{}}},api:{data:{targets:{typecheck:{},build:{}}}},admin:{data:{targets:{typecheck:{}}}},unrelated:{data:{targets:{typecheck:{}}}}},dependencies:{contracts:[{target:'npm:zod'}],api:[{target:'contracts'}],admin:[{target:'contracts'}],unrelated:[]}};
 const result=plan(graph,'zod');assert.deepEqual(result.directImporters,['contracts']);assert.deepEqual(result.impactedProjects,['admin','api','contracts']);assert.deepEqual(result.ordinaryTargets,['admin:typecheck','api:typecheck','api:build']);assert.equal(result.versionChanged,false);assert.deepEqual(result.globalGates,['pnpm lint','pnpm test:tooling']);
});
test('refuses unknown dependency instead of guessing upgrade impact',()=>assert.throws(()=>plan({nodes:{},dependencies:{}},'unknown'),/not discovered/));

test('uses verified source import owners when npm external nodes are absent',()=>{
 const graph={nodes:{contracts:{data:{targets:{}}},api:{data:{targets:{}}}},dependencies:{contracts:[],api:[{target:'contracts'}]}};
 assert.deepEqual(plan(graph,'zod',['contracts']).impactedProjects,['api','contracts']);
 assert.throws(()=>plan(graph,'zod',['invented']),/owner/);
});
