import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const {checkpoints}=JSON.parse(await readFile(new URL('../../tools/course-recovery/section10-checkpoints.json',import.meta.url),'utf8'));
const source=(commit,file)=>execFileSync('git',['show',`${commit}:${file}`],{encoding:'utf8'});
for(const state of checkpoints.slice(1)) {
 const code=source(state.sourceCommit,'scripts/artifact-publication.mjs');
 const publication=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 test(`${state.id} recovery rejects normalized build dates`,()=>{
  const artifact={name:'api',sourceCommit:state.sourceCommit,imageId:'sha256:'+'b'.repeat(64),archiveSha256:'c'.repeat(64),buildTime:'2026-02-31T10:00:00.000Z',toolchain:'node24.18.0-pnpm11.17.0',source:'https://github.com/madeupdev/advanced-monorepos-project',status:'staged'};
  const event={name:'workflow_dispatch',repository:'madeupdev/advanced-monorepos-project',ref:'refs/heads/codex/section-10-recovery-correction',sha:state.sourceCommit,mode:'dry-run'};
  assert.throws(()=>publication.publicationPlan({manifest:{sourceCommit:state.sourceCommit,artifacts:[artifact]},selection:{deployables:['api']},event}),/metadata|provenance/);
  assert.equal(publication.publicationPlan({manifest:{sourceCommit:state.sourceCommit,artifacts:[{...artifact,buildTime:'2024-02-29T10:00:00.000Z'}]},selection:{deployables:['api']},event}).artifacts.length,1);
 });
 test(`${state.id} recovery checks migration-only image credentials`,async()=>{
  assert.equal(typeof publication.verifyNoLocalCredentials,'function');
  await assert.rejects(()=>publication.verifyNoLocalCredentials([{name:'migrations',imageId:'migration-image'}],async(...args)=>{assert.ok(args.includes('migration-image'));assert.ok(args.includes('--entrypoint'));throw new Error('credentials present');}),/credentials present/);
  assert.match(source(state.sourceCommit,'scripts/verify-artifacts.mjs'),/await verifyNoLocalCredentials\(manifest.artifacts,docker\)/);
 });
}
test('final recovery stages push comparisons without weakening required validation',()=>{
 const code=source(checkpoints.at(-1).sourceCommit,'.github/workflows/publish.yml');
 assert.match(code,/CI_BASE: \$\{\{ inputs.base \|\| github.event.before \}\}/);
 assert.match(code,/LAST_SUCCESSFUL_SHA: \$\{\{ steps.success.outputs.sha \}\}/);
});
