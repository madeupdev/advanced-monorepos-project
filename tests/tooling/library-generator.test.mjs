import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing');
const { readJson, writeJson, addProjectConfiguration } = require('@nx/devkit');
const file = new URL('../../tools/generators/library/generator.cjs', import.meta.url);
let generator;
test('workspace library generator exists', () => {
  assert.ok(existsSync(file), 'missing supported source-library generator');
  generator = require(fileURLToPath(file));
});
function setup() {
  const tree = createTreeWithEmptyWorkspace();
  writeJson(tree, 'tsconfig.base.json', {compilerOptions:{paths:{}}});
  tree.write('.github/CODEOWNERS', '* @robdonn\n/libs/ @robdonn\n');
  return tree;
}
const options = {name:'rental-policy',type:'domain',runtime:'universal',scope:'rental',owner:'robdonn'};
test('generates a usable source library without package architecture changes', async () => {
  const tree = setup(); await generator(tree, options);
  const p = readJson(tree,'libs/rental-policy/project.json');
  assert.equal(p.name,'@madeup-video/rental-policy');
  assert.equal(p.sourceRoot,'libs/rental-policy/src');
  assert.deepEqual(p.tags,['type:domain','runtime:universal','scope:rental']);
  assert.deepEqual(p.metadata.owners,['robdonn']);
  assert.equal(p.targets.test.executor,'nx:run-commands');
  assert.equal(p.targets.test.cache,false);
  assert.match(p.targets.test.options.command,/node --import tsx --test/);
  assert.match(p.targets.typecheck.options.command,/tsc.*--noEmit/);
  assert.match(tree.read('libs/rental-policy/src/index.ts','utf8'), /export/);
  assert.ok(tree.exists('libs/rental-policy/src/lib/rental-policy.test.ts'));
  assert.equal(tree.exists('libs/rental-policy/package.json'),false);
  assert.deepEqual(readJson(tree,'tsconfig.base.json').compilerOptions.paths['@madeup-video/rental-policy'],['./libs/rental-policy/src/index.ts']);
});
test('allows a contract in shared scope', async () => {
  const tree = setup(); await generator(tree,{...options,name:'shared-contract',type:'contract',scope:'shared'});
  assert.deepEqual(readJson(tree,'libs/shared-contract/project.json').tags,['type:contract','runtime:universal','scope:shared']);
});
for (const bad of [
  {name:'eval'},{name:'arguments'},{name:'123-policy'},{name:'default'},{name:'class'},{name:'../escape'},{name:'nested/path'},{name:'C:\\escape'},{name:'UpperCase'},
  {name:'con'},{name:'nul'},{name:'com1'},{name:'aux'}, {name:'a'.repeat(80)},
  {owner:'invented-team'},{owner:'robdonn;touch x'}, {type:'ui'},
  {runtime:'server'}, {scope:'workspace'}, {directory:'../../escape'}, {unknown:true},
]) test(`rejects invalid request before writes: ${JSON.stringify(bad)}`, async () => {
  const tree = setup(); const before=tree.listChanges();
  await assert.rejects(async () => generator(tree,{...options,...bad}));
  assert.deepEqual(tree.listChanges(),before);
});
for (const collision of ['file','directory','alias','project']) test(`rejects ${collision} collision without mutation`, async () => {
  const tree = setup();
  if(collision==='file') tree.write('libs/rental-policy','occupied');
  if(collision==='directory') tree.write('libs/rental-policy/notes.md','occupied');
  if(collision==='alias') writeJson(tree,'tsconfig.base.json',{compilerOptions:{paths:{'@madeup-video/rental-policy':['elsewhere.ts']}}});
  if(collision==='project') addProjectConfiguration(tree,'@madeup-video/rental-policy',{root:'libs/elsewhere',projectType:'library'});
  const before=tree.listChanges(); await assert.rejects(async()=>generator(tree,options));
  assert.deepEqual(tree.listChanges(),before);
});

test('rejects an occupied libs ancestor before writes',async()=>{
 const tree=setup();tree.write('libs','occupied');const before=tree.listChanges();
 await assert.rejects(async()=>generator(tree,options),/ancestor|directory/);assert.deepEqual(tree.listChanges(),before);
});

test('rejects symlink ancestors in a real Nx Tree before staged writes',async()=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'generator-safety-'));
 try {
  const root=path.join(temporary,'workspace'),outside=path.join(temporary,'outside');await mkdir(root);await mkdir(outside);
  await symlink(outside,path.join(root,'libs'),process.platform==='win32'?'junction':'dir');
  const {FsTree}=require('nx/src/generators/tree');const tree=new FsTree(root,false);
  writeJson(tree,'nx.json',{});writeJson(tree,'tsconfig.base.json',{compilerOptions:{paths:{}}});tree.write('.github/CODEOWNERS','* @robdonn\n');
  const before=tree.listChanges();await assert.rejects(async()=>generator(tree,options),/symlink|ancestor/);assert.deepEqual(tree.listChanges(),before);
 } finally {await rm(temporary,{recursive:true,force:true});}
});

test('rejects a symlink tsconfig mutation destination before writes',async()=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'generator-alias-safety-'));
 try {
  const root=path.join(temporary,'workspace');await mkdir(root);
  const outside=path.join(temporary,'outside.json');await import('node:fs/promises').then(fs=>fs.writeFile(outside,JSON.stringify({compilerOptions:{paths:{}}})));
  await symlink(outside,path.join(root,'tsconfig.base.json'));
  const {FsTree}=require('nx/src/generators/tree');const tree=new FsTree(root,false);writeJson(tree,'nx.json',{});tree.write('.github/CODEOWNERS','* @robdonn\n');
  const before=tree.listChanges();await assert.rejects(async()=>generator(tree,options),/symlink/);assert.deepEqual(tree.listChanges(),before);
 } finally {await rm(temporary,{recursive:true,force:true});}
});
