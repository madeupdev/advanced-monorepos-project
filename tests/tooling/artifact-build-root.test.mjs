import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
test('recovered source cannot inherit an unrelated parent Git repository',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'section10-parent-git-'));
 try {
  execFileSync('git',['init','-q',root]);const source=path.join(root,'recovered');mkdirSync(source);
  const plan=path.join(root,'plan.json'),output=path.join(root,'staged');writeFileSync(plan,JSON.stringify({deployables:[]}));
  const script=fileURLToPath(new URL('../../scripts/build-artifacts.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'--plan',plan,'--output',output],{cwd:source,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/project Git root/);assert.equal(existsSync(output),false);
 } finally {rmSync(root,{recursive:true,force:true});}
});
