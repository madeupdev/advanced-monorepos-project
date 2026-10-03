// Instructor-only private draft rehearsals; never publishes recovery assets.
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,cp,rm,lstat,readdir,access,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import net from 'node:net';
const exec=promisify(execFile);
const [projectArg,cliArg,round,outputArg]=process.argv.slice(2);
const project=path.resolve(projectArg),cli=path.resolve(cliArg),output=path.resolve(outputArg);
assert.ok(['transition','section-one','section-two'].includes(round));assert.equal(process.version,'v24.18.0');
const register=JSON.parse(await readFile(new URL('section11-checkpoints.json',import.meta.url)));
const states=register.states;assert.equal(states.length,5);assert.ok(states.every(s=>s.status==='draft'));
const root=await mkdtemp(path.join(await realpath(tmpdir()),`section11-${round}-`));await mkdir(output,{recursive:true});
const records=[],result={round,platform:process.platform,cliCommit:'2dcd4dc53b9f40923f604f521fbf05453e83c376',privateSyntheticAncestry:true,externallyPublished:false,records};
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',['-C',project,...args],{maxBuffer:128*1024*1024});
async function command(label,executable,args,cwd,env=process.env,expected=0){
 const start=Date.now();let stdout='',stderr='',status=0;
 try{const r=await exec(executable,args,{cwd,env,maxBuffer:64*1024*1024,timeout:1800000});stdout=r.stdout;stderr=r.stderr;}
 catch(e){stdout=e.stdout??'';stderr=e.stderr??e.message;status=typeof e.code==='number'?e.code:1;}
 const clean=s=>String(s).replace(/postgresql:\/\/[^\s"']+/g,'[task-owned database URL]');
 await writeFile(path.join(output,label+'.log'),clean(stdout)+clean(stderr));
 const record={label,status,expected,milliseconds:Date.now()-start};
 if(expected===0)assert.equal(status,0,`${label} failed; inspect retained log`);else assert.notEqual(status,0,`${label} should fail`);
 return {...record,stdout,stderr};
}
const trees=new Map();
async function tree(commit){
 if(trees.has(commit))return trees.get(commit);
 const files=[];
 for(const entry of git('ls-tree','-rz','--full-tree',commit).toString().split('\0').filter(Boolean)){
  const [meta,file]=entry.split('\t'),[mode,type,blob]=meta.split(' ');assert.equal(type,'blob');assert.ok(['100644','100755'].includes(mode));
  files.push({path:file,mode:mode==='100755'?493:420,sha256:hash(git('cat-file','blob',blob))});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path,'en'));const result={algorithm:'course-tree-v1',files};trees.set(commit,result);return result;
}
async function verify(source,commit,strict=false){
 const expected=await tree(commit);
 for(const file of expected.files){assert.equal(hash(await readFile(path.join(source,file.path))),file.sha256,file.path);assert.equal((await lstat(path.join(source,file.path))).mode&511,file.mode,file.path);}
 if(strict){const found=[];let count=0;async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())await visit(path.join(dir,e.name));else{assert.ok(e.isFile());found.push(path.relative(source,path.join(dir,e.name)));count++;}}}await visit(source);assert.equal(count,expected.files.length,`Unexpected files: ${found.filter(p=>!expected.files.some(f=>f.path===p)).join(', ')}`);}
 return expected.files.length;
}
async function releasedPorts(){
 for(const port of [3333,3100,3200])await new Promise((resolve,reject)=>{const s=net.createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();reject(new Error(`Port ${port} still bound`));});s.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));s.setTimeout(1000,()=>{s.destroy();reject(new Error('Port audit timed out'));});});
 return [3333,3100,3200];
}
let databases=[];
const require=createRequire(path.join(project,'package.json'));const {Client}=require('pg');
const pgOptions={host:process.env.PGHOST??'127.0.0.1',port:Number(process.env.PGPORT??5432),user:process.env.PGUSER??'course',password:process.env.PGPASSWORD??'course',database:'postgres'};
async function sql(text,values){const c=new Client(pgOptions);await c.connect();try{return await c.query(text,values);}finally{await c.end();}}
async function cleanupDatabases(){const errors=[];for(const name of [...databases]){try{await sql('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await sql(`DROP DATABASE IF EXISTS "${name}"`);assert.equal((await sql('SELECT datname FROM pg_database WHERE datname=$1',[name])).rows.length,0);databases=databases.filter(n=>n!==name);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Owned database cleanup failed');}
try{
 assert.equal(execFileSync('git',['-c','core.fsmonitor=false','-C',cli,'rev-parse','HEAD']).toString().trim(),result.cliCommit);assert.equal(execFileSync('git',['-c','core.fsmonitor=false','-C',cli,'diff','HEAD']).length,0);
 await command('verify-cli-build','corepack',['pnpm','build'],cli);result.cliDistSha256=hash(await readFile(path.join(cli,'dist/cli.js')));
 const builder=path.join(root,'builder');await command('clone-builder','git',['clone','--no-hardlinks',project,builder],root);
 await command('builder-origin','git',['remote','set-url','origin',register.project.repository+'.git'],builder);
 await command('synthetic-builder-only','git',['update-ref','refs/remotes/origin/main',states.at(-1).sourceCommit],builder);
 const input=path.join(root,'register.json');await writeFile(input,JSON.stringify(register));
 for(const build of ['one','two'])await command('build-'+build,process.execPath,[path.join(cli,'dist/scripts/build-recovery-assets.js'),'--project',builder,'--register',input,'--output',path.join(root,build)],root);
 const manifest=JSON.parse(await readFile(path.join(root,'one/manifest.json')));
 for(const file of ['manifest.json','SHA256SUMS',...states.map(s=>s.asset)])assert.ok((await readFile(path.join(root,'one',file))).equals(await readFile(path.join(root,'two',file))));
 const recoveryStates=[],assetMap={};
 for(const state of states){
  const asset=manifest.assets.find(a=>a.id===state.id);assert.equal(asset.sha256,state.sha256);assert.equal(asset.sourceCommit,state.sourceCommit);
  recoveryStates.push({...state,tree:await tree(state.sourceCommit)});
  assetMap[`${register.release.repository}/releases/download/${encodeURIComponent(register.release.tag)}/${encodeURIComponent(state.asset)}`]=path.join(root,'one',state.asset);
 }
 const candidate=path.join(root,'candidate');await mkdir(path.join(candidate,'recovery'),{recursive:true});
 for(const name of ['dist','recipes','README.md','LICENSE.md'])await cp(path.join(cli,name),path.join(candidate,name),{recursive:true});
 const pkg=JSON.parse(await readFile(path.join(cli,'package.json')));pkg.version=register.courseVersion;await writeFile(path.join(candidate,'package.json'),JSON.stringify(pkg));
 const privateManifest={schemaVersion:1,courseVersion:register.courseVersion,project:register.project,release:register.release,recoveryStates:recoveryStates.map(({id,sourceCommit,asset,sha256,tree,verification})=>({id,sourceCommit,asset,sha256,tree,verification})),recipes:[]};
 const {validateManifest}=await import(pathToFileURL(path.join(cli,'dist/manifest/validate.js')));const validation=validateManifest(privateManifest);assert.ok(validation.ok,JSON.stringify(validation.issues));
 await writeFile(path.join(candidate,'recovery/course-v1.0.0.json'),JSON.stringify(privateManifest));
 const packed=await command('pack-private-cli','npm',['pack','--json','--ignore-scripts','--pack-destination',root],candidate,{...process.env,npm_config_cache:path.join(root,'npm-cache')});
 const tarball=path.join(root,JSON.parse(packed.stdout)[0].filename);result.installedCandidateSha256=hash(await readFile(tarball));
 const consumer=path.join(root,'consumer');await mkdir(consumer);await command('install-private-cli','corepack',['pnpm','add','--ignore-scripts','--dir',consumer,tarball],root);
 const binary=path.join(consumer,'node_modules/@madeup-video/course/dist/cli.js');
 const preload=path.join(root,'local-assets.mjs'),map=path.join(root,'asset-map.json');await writeFile(map,JSON.stringify(assetMap));
 await writeFile(preload,`import {readFile} from 'node:fs/promises';const map=JSON.parse(await readFile(process.env.COURSE_REHEARSAL_ASSET_MAP));globalThis.fetch=async input=>{const file=map[String(input)];if(!file)throw new Error('Unapproved URL');const bytes=await readFile(file);return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});};`);
 const cliEnv={...process.env,COURSE_REHEARSAL_ASSET_MAP:map};
 result.transport='Installed private CLI candidate; local fetch interception of exact manifest URLs. Published-package/release transport remains a gate.';
 async function recover(state,destination,label){
  const r=await command(label,process.execPath,['--import',preload,binary,'recover',state.id,'--directory',destination],consumer,cliEnv);
  assert.ok(r.stdout.includes(state.sourceCommit));assert.ok(r.stdout.includes(state.sha256));await verify(destination,state.sourceCommit,true);
 }
 // Every registered immutable source is restored with the installed CLI and compared independently to Git.
 result.registeredTreeAudits=[];
 for(const state of states){const destination=path.join(root,'audit-'+state.id);await recover(state,destination,'audit-'+state.id);result.registeredTreeAudits.push({id:state.id,sourceCommit:state.sourceCommit,archiveSha256:state.sha256,files:await verify(destination,state.sourceCommit,true)});await rm(destination,{recursive:true});}
 let source=path.join(root,'source');
 if(round!=='transition')await recover(states[0],source,'recover-section-start');
 for(let index=1;index<=3;index++){
  const state=states[index],previous=states[index-1];
  if(round==='transition')await recover(previous,source,'recover-start-'+index);
  const patch=path.join(root,'transition.patch');await writeFile(patch,git('diff','--binary','--no-renames',previous.sourceCommit,state.sourceCommit));
  await command('apply-transition-'+index,'git',['apply','--binary',patch],source);
  await verify(source,state.sourceCommit,true);
  await command('source-init-'+index,'git',['init','-q'],source);
  await command('source-fetch-'+index,'git',['fetch','--quiet',project,state.sourceCommit],source);
  await command('source-branch-'+index,'git',['symbolic-ref','HEAD','refs/heads/instructor-recovery'],source);
  await command('source-identity-'+index,'git',['update-ref','refs/heads/instructor-recovery',state.sourceCommit],source);
  await command('source-index-'+index,'git',['read-tree',state.sourceCommit],source);
  const cache=path.join(root,'cache-'+index),data=path.join(root,'data-'+index);
  const base=`section11_${round.replaceAll('-','_')}_${index}_${process.pid}`,names=[base,base+'_test'];
  const env={...process.env,CI:'true',NX_DAEMON:'false',NX_NO_CLOUD:'true',NX_PREFER_NODE_STRIP_TYPES:'false',NX_CACHE_DIRECTORY:cache,NX_WORKSPACE_DATA_DIRECTORY:data,NX_NATIVE_FILE_CACHE_DIRECTORY:path.join(data,'native'),NX_SKIP_NX_CACHE:'false',DATABASE_URL:`postgresql://${pgOptions.user}:${pgOptions.password}@${pgOptions.host}:${pgOptions.port}/${names[0]}`,TEST_DATABASE_URL:`postgresql://${pgOptions.user}:${pgOptions.password}@${pgOptions.host}:${pgOptions.port}/${names[1]}`,NODE_PATH:[path.join(source,'node_modules/nx/node_modules'),path.join(source,'node_modules'),path.join(source,'node_modules/.pnpm/node_modules')].join(path.delimiter)};
  const record={state:state.id,sourceCommit:state.sourceCommit,archiveSha256:state.sha256,previous:previous.id,startingSourceCommit:previous.sourceCommit,startingArchiveSha256:previous.sha256,commands:[]};records.push(record);
  try{
   for(const name of names){await sql(`CREATE DATABASE "${name}"`);databases.push(name);}
   await releasedPorts();
   for(const [label,args]of [['install',['pnpm','install','--frozen-lockfile']],['generate',['pnpm','db:generate']],['browser',['pnpm','exec','playwright','install',...(process.platform==='linux'?['--with-deps']:[]),'chromium']],['migrate',['pnpm','exec','prisma','migrate','deploy']],['seed',['pnpm','exec','prisma','db','seed']],...['lint','typecheck','test:all','build'].map(n=>[n.replace(':','-'),['pnpm',n]])]){
    const r=await command(`${index}-${label}`,'corepack',args,source,env);record.commands.push({label,status:r.status,milliseconds:r.milliseconds});
   }
   if(index>=2)for(const mode of ['library','drift','graph','cache']){const report=path.join(output,`${index}-${mode}.json`);await command(`${index}-${mode}`,process.execPath,['scripts/team-demo.mjs',mode,report],source,env);const demo=JSON.parse(await readFile(report));assert.equal(demo.status,'passed');assert.equal(demo.cleanup.sourceRestored,true);assert.equal(demo.cleanup.fixtureAndIsolatedCacheRemoved,true);}
   if(index===3)await command('upgrade-plan',process.execPath,['scripts/upgrade-plan.mjs','zod'],source,env);
   await verify(source,state.sourceCommit);assert.equal(execFileSync('git',['-C',source,'diff','--binary','HEAD']).length,0);
   record.sourceRestored=true;record.requiredRootChecks=['lint','typecheck','test:all','build'];record.status='passed';
  }finally{
   const cleanup=await Promise.allSettled([cleanupDatabases(),releasedPorts(),rm(cache,{recursive:true,force:true}),rm(data,{recursive:true,force:true})]);
   record.cleanupErrors=cleanup.flatMap((r,i)=>r.status==='rejected'?[{step:i,message:r.reason.message}]:[]);
   record.databasesRemoved=cleanup[0].status==='fulfilled';record.portsReleased=cleanup[1].status==='fulfilled'?cleanup[1].value:[];
   await assert.rejects(access(cache));await assert.rejects(access(data));record.isolatedCacheRemoved=true;
   await rm(path.join(source,'.nx'),{recursive:true,force:true});
   record.cleanupVerified=record.databasesRemoved&&record.isolatedCacheRemoved&&record.cleanupErrors.length===0;
   await writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');assert.equal(record.cleanupErrors.length,0,'Owned cleanup failed');
  }
  if(round==='transition')await rm(source,{recursive:true});
  else if(index<3){
   // Preserve only tracked source between lecture transitions; dependencies are reinstalled frozen.
   for(const artifact of ['node_modules','generated','.nx','dist','playwright-report','test-results','apps/storefront/.next','tests/tooling/dist','next-env.d.ts','apps/storefront/next-env.d.ts','apps/storefront/tsconfig.tsbuildinfo'])await rm(path.join(source,artifact),{recursive:true,force:true});
   await rm(path.join(source,'.git'),{recursive:true,force:true});await verify(source,state.sourceCommit,true);
  }
 }
 result.status='passed';result.completeSection=round!=='transition';result.freshTransitions=3;
}finally{
 const cleanup=await Promise.allSettled([cleanupDatabases(),rm(root,{recursive:true,force:true})]);result.finalCleanupErrors=cleanup.flatMap((r,i)=>r.status==='rejected'?[{step:i,message:r.reason.message}]:[]);await assert.rejects(access(root));result.taskTemporaryRemoved=true;if(result.finalCleanupErrors.length)result.status='failed';if(!result.status)result.status='failed';await writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
}
console.log(`Section 11 ${round}: ${result.status}; three transitions, exact source restoration and owned cleanup verified.`);

if(result.status!=='passed')process.exitCode=1;
