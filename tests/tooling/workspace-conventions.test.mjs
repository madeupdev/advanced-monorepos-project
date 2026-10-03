import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
let validate;
test('metadata drift checker exists',async()=>{
 assert.ok(existsSync(new URL('../../scripts/workspace-conventions.mjs',import.meta.url)),'missing metadata policy');
 ({validateMetadata:validate}=await import('../../scripts/workspace-conventions.mjs'));
});
function good(){return {nodes:{'@madeup-video/policy':{data:{root:'libs/policy',sourceRoot:'libs/policy/src',projectType:'library',tags:['type:domain','runtime:universal','scope:rental'],metadata:{owners:['robdonn']},targets:{test:{executor:'nx:run-commands',cache:false,options:{command:'node --import tsx --test libs/policy/src/lib/policy.test.ts'}},typecheck:{executor:'nx:run-commands',options:{command:'node node_modules/typescript/bin/tsc --noEmit -p libs/policy/tsconfig.json'}}}}}},aliases:{'@madeup-video/policy':['./libs/policy/src/index.ts']},entries:['libs/policy/src/index.ts']};}
test('accepts independently verifiable generated source metadata',()=>assert.deepEqual(validate(good()),[]));
for(const [label,mutate,pattern] of [
 ['missing owner',x=>delete x.nodes['@madeup-video/policy'].data.metadata,/owner/],
 ['invented owner',x=>x.nodes['@madeup-video/policy'].data.metadata.owners=['invented'],/owner/],
 ['missing runtime',x=>x.nodes['@madeup-video/policy'].data.tags=x.nodes['@madeup-video/policy'].data.tags.filter(tag=>!tag.startsWith('runtime:')),/runtime/],
 ['missing scope',x=>x.nodes['@madeup-video/policy'].data.tags.pop(),/scope/],
 ['contradictory runtime',x=>x.nodes['@madeup-video/policy'].data.tags.push('runtime:server'),/runtime/],
 ['unsupported metadata',x=>x.nodes['@madeup-video/policy'].data.tags=['type:domain','runtime:server','scope:rental'],/combination/],
 ['deep alias',x=>x.aliases['@madeup-video/policy']=['./libs/policy/src/lib/policy.ts'],/alias/],
 ['missing entry',x=>x.entries=[],/entry/],
 ['missing test',x=>delete x.nodes['@madeup-video/policy'].data.targets.test,/test/],
 ['missing typecheck',x=>delete x.nodes['@madeup-video/policy'].data.targets.typecheck,/typecheck/],
 ['empty validation',x=>x.nodes['@madeup-video/policy'].data.targets.test.options.command='echo skipped',/test/],
 ['cached behavior test',x=>x.nodes['@madeup-video/policy'].data.targets.test.cache=true,/test/],
 ['orphan alias',x=>x.aliases['@madeup-video/orphan']=['./libs/orphan/src/index.ts'],/orphan/],
])test(`detects ${label}`,()=>{const x=good();mutate(x);assert.match(validate(x).join('\n'),pattern);});

test('the actual Nx graph satisfies ownership and source-entry policy',async()=>{
 const {inspectWorkspace}=await import('../../scripts/workspace-conventions.mjs');
 assert.deepEqual(inspectWorkspace().issues,[]);
});
