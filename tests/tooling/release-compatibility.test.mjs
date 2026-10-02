import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
test('built old and new API artifacts obey the real PostgreSQL compatibility window', {skip:!process.env.SECTION10_COMPATIBILITY},async()=>{
 const output=process.env.SECTION10_COMPATIBILITY;
 execFileSync(process.execPath,['scripts/release-compatibility.mjs','--output',output],{stdio:'inherit',timeout:180000});
 const result=JSON.parse(await readFile(output,'utf8'));
 assert.deepEqual(result.matrix.map(r=>[r.stage,r.old,r.new]),[['initial',200,500],['unsafe-rename',500,200],['restored',200,500],['expanded',200,200],['contracted',500,200],['safe-restored',200,200]]);
 assert.equal(result.cleanup.containersRemoved,true);assert.equal(result.cleanup.networkRemoved,true);
 assert.equal(result.sourceRestored,true);
 assert.equal(result.matrix[1].oldErrorCode,'42703');
});
