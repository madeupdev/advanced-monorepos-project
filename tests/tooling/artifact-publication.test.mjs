import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeEvent, publicationPlan } from '../../scripts/artifact-publication.mjs';
const source='a'.repeat(40), repository='madeupdev/advanced-monorepos-project';
const event={name:'workflow_dispatch',repository,ref:'refs/heads/codex/section-10-project',sha:source,mode:'dry-run'};
const artifact=name=>({name,sourceCommit:source,imageId:'sha256:'+'b'.repeat(64),archiveSha256:'c'.repeat(64),buildTime:'2026-10-02T10:00:00.000Z',toolchain:'node24.18.0-pnpm11.17.0',source:'https://github.com/'+repository,status:'staged'});
test('authorized dispatch is dry-run only',()=>assert.equal(authorizeEvent(event,source),true));
for(const altered of [{name:'pull_request'},{repository:'attacker/fork'},{ref:'refs/tags/release'},{sha:'d'.repeat(40)},{mode:'publish'}])test('rejects unauthorized '+JSON.stringify(altered),()=>assert.throws(()=>authorizeEvent({...event,...altered},source),/Unauthorized/));
test('publishes only selected artifacts in dry-run plan',()=>{
 const p=publicationPlan({manifest:{sourceCommit:source,artifacts:['admin','api','storefront','migrations'].map(artifact)},selection:{deployables:['api']},event});
 assert.deepEqual(p.artifacts.map(a=>a.name),['api']);assert.equal(p.status,'dry-run');assert.equal(p.externallyPublished,false);
});
test('missing selected artifact fails',()=>assert.throws(()=>publicationPlan({manifest:{sourceCommit:source,artifacts:[]},selection:{deployables:['api']},event}),/Missing/));
for(const key of ['imageId','archiveSha256','sourceCommit','toolchain','buildTime','source'])test('rejects missing '+key,()=>{const a=artifact('api');delete a[key];assert.throws(()=>publicationPlan({manifest:{sourceCommit:source,artifacts:[a]},selection:{deployables:['api']},event}),/metadata|provenance/);});
test('inconsistent source fails',()=>assert.throws(()=>publicationPlan({manifest:{sourceCommit:source,artifacts:[{...artifact('api'),sourceCommit:'d'.repeat(40)}]},selection:{deployables:['api']},event}),/provenance/));
test('unknown deployable fails',()=>assert.throws(()=>publicationPlan({manifest:{sourceCommit:source,artifacts:[]},selection:{deployables:['unrelated']},event}),/Unknown/));
test('duplicates fail',()=>assert.throws(()=>publicationPlan({manifest:{sourceCommit:source,artifacts:[artifact('api'),artifact('api')]},selection:{deployables:['api']},event}),/Duplicate/));
test('staged archive bytes cannot disagree with recorded digest', async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'section10-tamper-'));
 try {
  await writeFile(join(directory,'api.docker.tar'),'tampered bytes');
  const publication=await import('../../scripts/artifact-publication.mjs');
  assert.equal(typeof publication.verifyStaged,'function');
  await assert.rejects(()=>publication.verifyStaged({artifacts:[{...artifact('api'),archive:'api.docker.tar'}]},directory),/archive digest/);
 } finally {await rm(directory,{recursive:true,force:true});}
});

test('scoped same-repository push may stage a dry-run',()=>assert.equal(authorizeEvent({...event,name:'push'},source),true));
test('a correctly hashed archive for another image is rejected',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createHash}=await import('node:crypto');const {verifyStaged}=await import('../../scripts/artifact-publication.mjs');
 const directory=await mkdtemp(join(tmpdir(),'section10-wrong-image-'));
 try {
  const config='{}',id=createHash('sha256').update(config).digest('hex');
  await writeFile(join(directory,id+'.json'),config);await writeFile(join(directory,'manifest.json'),JSON.stringify([{Config:id+'.json',Layers:[]}]));
  const archive=join(directory,'api.docker.tar');execFileSync('tar',['-cf',archive,'-C',directory,'manifest.json',id+'.json']);
  const archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
  await assert.rejects(()=>verifyStaged({artifacts:[{...artifact('api'),archive:'api.docker.tar',archiveSha256}]},directory),/archive image identity/);
 } finally {await rm(directory,{recursive:true,force:true});}
});
