import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDemo } from '../../scripts/team-demo.mjs';
for(const mode of ['library','drift','graph','cache'])test(`actual disposable ${mode} scenario restores source and cleans owned state`,async()=>{
 const report=await runDemo(mode,{cwd:fileURLToPath(new URL('../../',import.meta.url))});
 assert.equal(report.status,'passed');
 assert.equal(report.cleanup.sourceRestored,true);
 assert.equal(report.cleanup.fixtureAndIsolatedCacheRemoved,true);
 assert.ok(report.checks.length>0);
});
