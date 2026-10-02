import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modes=['library','drift','graph','cache'];
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const put=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
export async function runDemo(mode,{cwd=process.cwd()}={}) {
  assert.ok(modes.includes(mode),'Choose library, drift, graph or cache');
  const temporary=await mkdtemp(path.join(tmpdir(),'section11-demo-'));
  const source=path.join(temporary,'source');await mkdir(source);
  const files=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd}).toString().split('\0').filter(Boolean);
  const hashes=new Map();
  const report={mode,observations:[],checks:[],cleanup:{}};
  const cache=path.join(temporary,'cache'),workspace=path.join(temporary,'workspace-data');
  const env={...process.env,NX_DAEMON:'false',NX_NO_CLOUD:'true',NX_TUI:'false',NX_INTERACTIVE:'false',NX_PREFER_NODE_STRIP_TYPES:'false',NX_CACHE_DIRECTORY:cache,NX_WORKSPACE_DATA_DIRECTORY:workspace,TEST_DATABASE_URL:process.env.TEST_DATABASE_URL||'postgresql://fixture:fixture@127.0.0.1:5432/section11_test',NODE_PATH:[path.join(cwd,'node_modules/nx/node_modules'),path.join(cwd,'node_modules'),path.join(cwd,'node_modules/.pnpm/node_modules')].join(path.delimiter)};
  const run=(label,args,expected=0)=>{
    const result=spawnSync(process.execPath,args,{cwd:source,env,encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000});
    if(result.error)throw result.error;
    report.checks.push({label,status:result.status,expected,stdout:result.stdout,stderr:result.stderr});
    if(expected===0)assert.equal(result.status,0,`${label}: ${result.stderr} ${result.stdout}`);
    else assert.ok(result.status!==0,`${label} should reject drift`);
    return result.stdout+result.stderr;
  };
  const nx=(label,args,expected=0)=>run(label,['node_modules/nx/dist/bin/nx.js',...args],expected);
  const graph=()=>JSON.parse(nx('project graph',['graph','--file=stdout'])).graph;
  try {
    for(const f of files){
      const data=await readFile(path.join(cwd,f));hashes.set(f,createHash('sha256').update(data).digest('hex'));
      await mkdir(path.dirname(path.join(source,f)),{recursive:true});await cp(path.join(cwd,f),path.join(source,f));
    }
    await symlink(path.join(cwd,'node_modules'),path.join(source,'node_modules'),'dir');
    const initial=graph();
    if(mode==='library') {
      nx('generate library',['g',`${path.join(source,'tools/generators.json')}:library`,'--name=rental-policy','--type=domain','--runtime=universal','--scope=rental','--owner=madeupdev','--interactive=false']);
      const generated=JSON.parse(nx('discover generated project',['show','project','@madeup-video/rental-policy','--json']));
      assert.equal(generated.root,'libs/rental-policy');
      for(const target of ['test','typecheck'])nx(`focused ${target}`,['run',`@madeup-video/rental-policy:${target}`,'--skip-nx-cache']);
      run('generated boundary lint',['scripts/lint.mjs','libs/rental-policy']);
      run('generated metadata',['scripts/workspace-conventions.mjs']);
      await rm(path.join(source,'libs/rental-policy'),{recursive:true});
      const ts=await json(path.join(source,'tsconfig.base.json'));delete ts.compilerOptions.paths['@madeup-video/rental-policy'];await put(path.join(source,'tsconfig.base.json'),ts);
      await rm(workspace,{recursive:true,force:true});
      assert.deepEqual(Object.keys(graph().nodes).sort(),Object.keys(initial.nodes).sort());
      report.observations.push({generatedDiscovered:true,focusedValidationPassed:true,originalProjectInventoryRestored:true});
    }
    if(mode==='drift') {
      const root='libs/bypassed-policy';await mkdir(path.join(source,root,'src'),{recursive:true});
      await put(path.join(source,root,'project.json'),{name:'@madeup-video/bypassed-policy',projectType:'library',sourceRoot:`${root}/src`,tags:['type:domain','runtime:server','scope:rental']});
      await writeFile(path.join(source,root,'src/index.ts'),'export { getDatabase } from "@madeup-video/database";\n');
      const drift=graph();assert.ok(drift.dependencies['@madeup-video/bypassed-policy'].some(e=>e.target==='@madeup-video/database'));
      const metadata=run('metadata rejection',['scripts/workspace-conventions.mjs'],1);assert.match(metadata,/owner/);assert.match(metadata,/alias/);assert.match(metadata,/test/);assert.match(metadata,/combination/);
      const boundary=run('boundary rejection',['scripts/lint.mjs',`${root}/src/index.ts`],1);assert.match(boundary,/only depend|constraint|tags/i);
      const config=await json(path.join(source,root,'project.json'));config.tags=['type:domain','runtime:universal','scope:rental'];config.metadata={owners:['madeupdev']};
      config.targets={test:{executor:'nx:run-commands',cache:false,options:{command:`node --import tsx --test ${root}/policy.test.ts`}},typecheck:{executor:'nx:run-commands',options:{command:`node node_modules/typescript/bin/tsc --noEmit -p ${root}/tsconfig.json`}}};await put(path.join(source,root,'project.json'),config);
      await writeFile(path.join(source,root,'src/index.ts'),'export const policy = (value: string): string => value;\n');
      await writeFile(path.join(source,root,'policy.test.ts'),'import assert from "node:assert/strict"; import {test} from "node:test"; import {policy} from "./src/index.ts"; test("contract preserves a decision",()=>assert.equal(policy("approved"),"approved"));\n');
      await put(path.join(source,root,'tsconfig.json'),{extends:'../../tsconfig.base.json',compilerOptions:{strict:true,noEmit:true,module:'ESNext',moduleResolution:'Bundler',skipLibCheck:true},include:['src/**/*.ts']});
      const ts=await json(path.join(source,'tsconfig.base.json'));ts.compilerOptions.paths['@madeup-video/bypassed-policy']=[`./${root}/src/index.ts`];await put(path.join(source,'tsconfig.base.json'),ts);
      run('metadata corrected',['scripts/workspace-conventions.mjs']);run('boundary corrected',['scripts/lint.mjs',`${root}/src/index.ts`]);
      assert.deepEqual(graph().dependencies['@madeup-video/bypassed-policy'],[]);
      for(const t of ['test','typecheck'])nx(`corrected ${t}`,['run',`@madeup-video/bypassed-policy:${t}`,'--skip-nx-cache']);
      await rm(path.join(source,root),{recursive:true});delete ts.compilerOptions.paths['@madeup-video/bypassed-policy'];await put(path.join(source,'tsconfig.base.json'),ts);
      await rm(workspace,{recursive:true,force:true});assert.deepEqual(Object.keys(graph().nodes).sort(),Object.keys(initial.nodes).sort());
      report.observations.push({graphExposedDatabaseEdge:true,metadataRejected:true,boundaryRejected:true,correctedChecksPassed:true,originalProjectInventoryRestored:true});
    }
    if(mode==='graph') {
      const p=path.join(source,'libs/ui/project.json'),original=await readFile(p);const config=JSON.parse(original);config.implicitDependencies=['@madeup-video/database'];await put(p,config);
      const edges=graph().dependencies['@madeup-video/ui'];assert.ok(edges.some(e=>e.target==='@madeup-video/database'&&e.type==='implicit'));
      report.observations.push({unexpectedEdge:edges.find(e=>e.target==='@madeup-video/database'),cause:'project.json implicitDependencies, not a source import'});
      await writeFile(p,original);await rm(workspace,{recursive:true,force:true});assert.deepEqual(graph().dependencies['@madeup-video/ui'],initial.dependencies['@madeup-video/ui']);
      report.observations.push({originalEdgesRestored:true});
    }
    if(mode==='cache') {
      const project=path.join(source,'tests/tooling/project.json'),config=await json(project),target=config.targets['test:cache-input'];
      target.inputs=['{projectRoot}/cache-fixture/**/*'];await put(project,config);
      const input=path.join(source,'tests/cache-fixture-input.txt'),output=path.join(source,'tests/tooling/dist/observation.json');
      const counter=path.join(temporary,'executions.txt');env.SECTION11_COUNTER=counter;
      const script=path.join(source,'tests/tooling/cache-fixture/run.mjs');
      await writeFile(script,(await readFile(script,'utf8'))+'\nconst counter = process.env.SECTION11_COUNTER;\nconst executions = Number(await readFile(counter,"utf8").catch(()=>"0"));\nawait writeFile(counter,String(executions+1));\n');
      const count=async()=>Number(await readFile(counter,'utf8'));
      const counts=[],cacheRuns=[];
      const observe=async expected=>{const actual=await count();assert.equal(actual,expected);counts.push(actual);const run=await json(path.join(cache,'run.json'));cacheRuns.push(run.tasks.map(({hash,cacheStatus})=>({hash,cacheStatus})));};
      await writeFile(input,'alpha\n');nx('warm defective cache',['run','@madeup-video/repository-tooling:test:cache-input']);assert.equal((await json(output)).value,'alpha');await observe(1);
      await writeFile(input,'beta\n');await rm(path.dirname(output),{recursive:true});nx('misleading cached result',['run','@madeup-video/repository-tooling:test:cache-input']);assert.equal((await json(output)).value,'alpha');await observe(1);
      nx('uncached diagnostic',['run','@madeup-video/repository-tooling:test:cache-input','--skip-nx-cache']);assert.equal((await json(output)).value,'beta');await observe(2);
      target.inputs.push('{workspaceRoot}/tests/cache-fixture-input.txt');await put(project,config);
      await writeFile(input,'gamma\n');nx('corrected cache baseline',['run','@madeup-video/repository-tooling:test:cache-input']);assert.equal((await json(output)).value,'gamma');await observe(3);
      await writeFile(input,'delta\n');nx('correct input-only invalidation',['run','@madeup-video/repository-tooling:test:cache-input']);assert.equal((await json(output)).value,'delta');await observe(4);
      await rm(path.dirname(output),{recursive:true});nx('correct cache restoration',['run','@madeup-video/repository-tooling:test:cache-input']);assert.equal((await json(output)).value,'delta');await observe(4);
      assert.equal(cacheRuns[0][0].hash,cacheRuns[1][0].hash);assert.notEqual(cacheRuns[3][0].hash,cacheRuns[4][0].hash);assert.equal(cacheRuns[4][0].hash,cacheRuns[5][0].hash);
      const restored=await readFile(output);assert.ok(restored.equals(Buffer.from(JSON.stringify({value:'delta'}))));
      report.observations.push({executionCounts:counts,cacheRuns,restoredOutputSha256:createHash('sha256').update(restored).digest('hex'),expected:'beta',staleCached:'alpha',uncached:'beta',correctedBaseline:'gamma',correctedInput:'delta',outputRestored:true});
    }
    report.status='passed';
  } finally {
    try {
    for(const [f,hash]of hashes)assert.equal(createHash('sha256').update(await readFile(path.join(cwd,f))).digest('hex'),hash,`caller source changed: ${f}`);
    report.cleanup.sourceRestored=true;
    } finally { await rm(temporary,{recursive:true,force:true}); }
    await assert.rejects(access(temporary));report.cleanup.fixtureAndIsolatedCacheRemoved=true;
    report.cleanup.processes='synchronous commands complete; no long-lived server launched';report.cleanup.databases='none created';report.cleanup.ports='none bound';
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const report=await runDemo(process.argv[2]);const output=process.argv[3];
  if(output)await put(output,report);else console.log(JSON.stringify(report,null,2));
}
