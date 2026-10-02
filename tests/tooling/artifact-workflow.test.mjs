import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('push staging uses the event comparison independently of the validation success boundary',async()=>{
 const source=await readFile(new URL('../../.github/workflows/publish.yml',import.meta.url),'utf8');
 const stage=source.split('  stage:')[1];
 assert.match(stage,/CI_BASE: \$\{\{ inputs.base \|\| github.event.before \}\}/);
 assert.match(stage,/\$CI_BASE.*0000000000000000000000000000000000000000/);
 assert.match(source,/LAST_SUCCESSFUL_SHA: \$\{\{ steps.success.outputs.sha \}\}/);
});

test('staging shell uses comparison for an existing push and full selection for a new branch or empty dispatch',async()=>{
 const source=await readFile(new URL('../../.github/workflows/publish.yml',import.meta.url),'utf8');
 const step=source.split('      - name: Select deployables')[1].split('      - name: Build from')[0];
 const script=step.split('        run: |\n')[1].split('\n').map(line=>line.slice(10)).join('\n');
 for(const base of ['a'.repeat(40),'0'.repeat(40),'']) {
  const {stdout}=await promisify(execFile)('bash',['-e','-c',`node() { printf '%s\\n' "$@"; }\n${script}`],{env:{...process.env,CI_BASE:base}});
  assert.equal(stdout.includes('--full'),base==='0'.repeat(40)||base==='');
  assert.ok(stdout.includes('scripts/affected-deployables.mjs'));
 }
});
