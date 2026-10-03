import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
test('contributor guidance names the actual individual review owner',async()=>{
 const root=new URL('../../',import.meta.url),guide=await readFile(new URL('AGENTS.md',root),'utf8'),rules=await readFile(new URL('.github/CODEOWNERS',root),'utf8');
 const owner=rules.split('\n').find(line=>line.startsWith('* ')).slice(2);
 assert.match(guide,new RegExp('Owner: '+owner+';'));
 assert.match(guide,/branch protection/);assert.match(guide,/Cost-aware Codex routing/);
});
