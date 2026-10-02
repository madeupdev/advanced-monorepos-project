import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
test('independent images run, migrate and serve required static assets', {skip:!process.env.SECTION10_ARTIFACT_MANIFEST}, async()=>{
 const output=process.env.SECTION10_RUNTIME_OUTPUT;
 assert.ok(output,'explicit output is required');
 execFileSync(process.execPath,['scripts/verify-artifacts.mjs','--manifest',process.env.SECTION10_ARTIFACT_MANIFEST,'--output',output],{stdio:'inherit',timeout:180000});
 const result=JSON.parse(await readFile(output,'utf8'));
 for(const check of ['migrationExecuted','apiHealth','apiDatabaseQuery','storefrontStartup','storefrontStaticAsset','adminDeepLink','adminStaticAsset','noLocalCredentials'])assert.equal(result.checks[check],true,check);
 assert.equal(result.cleanup.containersRemoved,true);assert.equal(result.cleanup.networkRemoved,true);
});
