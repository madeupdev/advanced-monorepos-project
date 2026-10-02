import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { selectDeployables } from '../../scripts/affected-deployables.mjs';
const all=['admin','api','migrations','storefront'];
for(const [name,files,expected] of [
 ['application',['apps/api/src/main.ts'],['api']],
 ['leaf',['libs/ui/src/index.ts'],['admin','storefront']],
 ['transitive contracts',['libs/contracts/src/index.ts'],['admin','api','storefront']],
 ['schema',['prisma/schema.prisma'],['api','migrations','storefront']],
 ['migration',['prisma/migrations/new/migration.sql'],['migrations']],
 ['global',['nx.json'],all],
 ['build definitions',['.dockerignore'],all],
 ['documentation',['README.md'],[]],
 ['empty',[],[]],
]) test(name, async()=>assert.deepEqual((await selectDeployables({files})).deployables,expected));
test('rejects traversal',async()=>assert.rejects(()=>selectDeployables({files:['../private']}),/Invalid/));
test('invalid range explicitly fails',()=>{
 const r=spawnSync(process.execPath,['scripts/affected-deployables.mjs'],{env:{...process.env,CI_BASE:'0'.repeat(40),CI_HEAD:'a'.repeat(40)},encoding:'utf8'});
 assert.notEqual(r.status,0); assert.match(r.stderr,/range|commit/i);
});
