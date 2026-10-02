// Instructor-only draft verification. Never upload the recovery archives.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectAndExtractArchive, verifyExtractedTree } from './archive.mjs';
const repository=process.cwd(),cli=path.resolve(process.argv[2]),round=process.argv[3];
assert.ok(['transition','section-one','section-two'].includes(round));assert.equal(process.version,'v24.18.0');
const root=path.join(process.env.RUNNER_TEMP||'/tmp',`section10-${round}`),evidence=path.join(repository,'section10-rehearsal-evidence');await mkdir(root);await mkdir(evidence,{recursive:true});
const git=(...args)=>execFileSync('git',['-C',repository,...args],{maxBuffer:64*1024*1024});
const commits=[['S09-final','06d3a05877a5ce5660471d33b08ab09536e83d57'],['S10-L01-deployables-built','9a5eee24b929a859174d0a518c49fc73a13f3be6'],['S10-L03-compatible-release','a316f46f8c85fbd811acae00f9a307c00442b7ce'],['S10-final','3bed9887df7c9fdbc35bca97f3e79eb9ddd430e9']];
const register={schemaVersion:1,courseVersion:'1.0.0',cliVersion:'1.0.0',cli:{packageName:'@madeup-video/course',repository:'https://github.com/madeupdev/madeup-video-course-cli'},project:{packageName:'@madeup-video/storefront',repository:'https://github.com/madeupdev/advanced-monorepos-project',localArtifacts:[]},release:{repository:'https://github.com/madeupdev/advanced-monorepos-project',tag:'course-v1.0.0',maxAssetBytes:268435456},states:commits.map(([id,sourceCommit])=>({id,sourceCommit,asset:id+'.tar.gz',sha256:'PENDING',status:'draft',verification:['pnpm lint','pnpm typecheck','pnpm test:all','pnpm build']})),recipes:[],authoringNotes:'Private rehearsal only: synthetic origin/main is confined to disposable builder clone; canonical ancestry is not asserted.'};
const registerPath=path.join(root,'register.json');await writeFile(registerPath,JSON.stringify(register));
const clone=path.join(root,'builder');execFileSync('git',['clone','--no-hardlinks',repository,clone]);execFileSync('git',['-C',clone,'remote','set-url','origin',register.project.repository+'.git']);execFileSync('git',['-C',clone,'update-ref','refs/remotes/origin/main',commits.at(-1)[1]]);
const builder=path.join(cli,'dist/scripts/build-recovery-assets.js');
for(const build of ['one','two'])execFileSync(process.execPath,[builder,'--project',clone,'--register',registerPath,'--output',path.join(root,build)],{stdio:'inherit'});
const manifest=JSON.parse(await readFile(path.join(root,'one/manifest.json')));
for(const asset of ['manifest.json','SHA256SUMS',...register.states.map(s=>s.asset)])assert.ok((await readFile(path.join(root,'one',asset))).equals(await readFile(path.join(root,'two',asset))),`Non-deterministic ${asset}`);
for(const [index,[id,commit]] of commits.entries())for(const build of ['one','two']) {
 const archive=path.join(root,build,id+'.tar.gz'),bytes=await readFile(archive);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.assets[index].sha256);
 const destination=path.join(root,`audit-${build}-${id}`);await inspectAndExtractArchive({archivePath:archive,destination});await verifyExtractedTree({repository,commit,destination});await rm(destination,{recursive:true});
}
const records=[];
async function command(label,cmd,args,cwd,env) {
 const result=spawnSync(cmd,args,{cwd,env,encoding:'utf8',maxBuffer:100*1024*1024});const output=(result.stdout||'')+(result.stderr||'');await writeFile(path.join(evidence,label+'.log'),output);assert.equal(result.status,0,`${label}: ${output.slice(-2500)}`);
 if(label.endsWith('-lint')){assert.match(output,/Nx graph initialized for module-boundary lint/);assert.doesNotMatch(output,/rule will be skipped|No cached ProjectGraph/);}
 return {command:[cmd,...args],exitCode:result.status,log:label+'.log'};
}
for(let index=1;index<commits.length;index++) {
 const [id,commit]=commits[index],[previous,previousCommit]=commits[index-1],work=path.join(root,id),source=path.join(work,'source');await mkdir(work);
 await inspectAndExtractArchive({archivePath:path.join(root,'one',previous+'.tar.gz'),destination:source});await verifyExtractedTree({repository,commit:previousCommit,destination:source});
 // Apply exactly the recorded source transition, never reset an existing checkout.
 const changes=git('diff','--name-status','--no-renames',previousCommit,commit).toString().trim().split('\n').filter(Boolean);
 for(const change of changes){const [status,file]=change.split('\t'),destination=path.join(source,file);if(status==='D')await rm(destination);else{await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,git('show',`${commit}:${file}`));const {chmod}=await import('node:fs/promises');await chmod(destination,git('ls-tree',commit,'--',file).toString().startsWith('100755')?0o755:0o644);}}
 await verifyExtractedTree({repository,commit,destination:source});
 // Recovery archives contain no Git metadata. Prepare instructor source identity locally.
 execFileSync('git',['init','-q',source]);execFileSync('git',['-C',source,'fetch','--quiet',repository,commit]);execFileSync('git',['-C',source,'symbolic-ref','HEAD','refs/heads/instructor-recovery']);execFileSync('git',['-C',source,'update-ref','refs/heads/instructor-recovery',commit]);execFileSync('git',['-C',source,'read-tree',commit]);
 const database=`s10_${round.replaceAll('-','_')}_${index}`,test=database+'_test';
 const env={...process.env,CI:'true',NX_DAEMON:'false',NX_NO_CLOUD:'true',NX_PREFER_NODE_STRIP_TYPES:'false',NX_SKIP_NX_CACHE:'true',NX_CACHE_DIRECTORY:path.join(work,'nx-cache'),NX_WORKSPACE_DATA_DIRECTORY:path.join(work,'nx-data'),npm_config_store_dir:path.join(work,'pnpm-store'),PLAYWRIGHT_BROWSERS_PATH:path.join(work,'browsers'),DATABASE_URL:`postgresql://course:course@127.0.0.1:5432/${database}`,TEST_DATABASE_URL:`postgresql://course:course@127.0.0.1:5432/${test}`,PGPASSWORD:'course',NODE_PATH:[path.join(source,'node_modules/nx/node_modules'),path.join(source,'node_modules'),path.join(source,'node_modules/.pnpm/node_modules')].join(path.delimiter)};
 const record={round,state:id,sourceCommit:commit,previous,archiveSha256:manifest.assets[index].sha256,commands:[]};let builderCreated=false,staged;
 try {
  for(const name of [database,test])execFileSync('createdb',['-h','127.0.0.1','-U','course',name],{env});
  for(const [label,args] of [['install',['pnpm','install','--frozen-lockfile']],['generate',['pnpm','db:generate']],['browser',['pnpm','exec','playwright','install','--with-deps','chromium']],['migrate',['pnpm','exec','prisma','migrate','deploy']],['seed',['pnpm','exec','prisma','db','seed']],...['lint','typecheck','test:all','build'].map(n=>[n.replace(':','-'),['pnpm',n]])])record.commands.push(await command(id+'-'+label,'corepack',args,source,env));
  const builderName=`section10-${round}-${index}`;execFileSync('docker',['buildx','create','--name',builderName,'--driver','docker-container','--use']);builderCreated=builderName;
  const plan=path.join(work,'deployables.json'),out=path.join(work,'staged');await command(id+'-select',process.execPath,['scripts/affected-deployables.mjs','--full','--output',plan],source,env);
  await command(id+'-artifacts',process.execPath,['scripts/build-artifacts.mjs','--no-cache','--plan',plan,'--output',out],source,env);staged=JSON.parse(await readFile(path.join(out,'artifacts.json')));
  // Fixture FROM uses an engine-local API ID, so build it with the engine builder.
  execFileSync('docker',['buildx','use','default']);
  await command(id+'-runtime',process.execPath,['scripts/verify-artifacts.mjs','--manifest',path.join(out,'artifacts.json'),'--output',path.join(evidence,id+'-runtime.json')],source,env);
  if(index>=2)await command(id+'-compatibility',process.execPath,['--test','tests/tooling/release-compatibility.test.mjs'],source,{...env,SECTION10_API_IMAGE:staged.artifacts.find(a=>a.name==='api').imageId,SECTION10_COMPATIBILITY:path.join(evidence,id+'-compatibility.json')});
  else {
   record.inspectionFixtureIds=[];
   for(const version of ['old','new']){const tag=`section10-inspect-${round}-${version}`;execFileSync('docker',['buildx','build','--load','--build-arg',`API_IMAGE=${staged.artifacts.find(a=>a.name==='api').tag}`,'--build-arg',`FIXTURE_VERSION=${version}`,'-t',tag,'fixtures/release-compatibility'],{cwd:source,stdio:'inherit'});record.inspectionFixtureIds.push({version,imageId:execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}']).toString().trim()});execFileSync('docker',['image','rm',tag]);}
  }
  const event=path.join(work,'event.json');await writeFile(event,JSON.stringify({name:'workflow_dispatch',repository:'madeupdev/advanced-monorepos-project',ref:'refs/heads/codex/section-10-project',sha:commit,mode:'dry-run'}));
  await command(id+'-publication',process.execPath,['scripts/artifact-publication.mjs','--manifest',path.join(out,'artifacts.json'),'--plan',plan,'--event',event,'--output',path.join(evidence,id+'-dry-run.json')],source,env);
  await writeFile(path.join(evidence,id+'-artifacts.json'),JSON.stringify(staged,null,2));
  if(index===3)for(const name of ['api','admin','storefront','migrations']) {
   const subset=path.join(out,name+'-manifest.json');await writeFile(subset,JSON.stringify({...staged,artifacts:staged.artifacts.filter(a=>a.name===name)}));
   await command(id+'-selected-'+name,process.execPath,['scripts/verify-artifacts.mjs','--selected','--manifest',subset,'--output',path.join(evidence,id+'-selected-'+name+'.json')],source,env);
   const selectedPlan=path.join(work,name+'-plan.json');await writeFile(selectedPlan,JSON.stringify({deployables:[name]}));
   const dryRun=path.join(evidence,id+'-selected-'+name+'-dry-run.json');await command(id+'-selected-publication-'+name,process.execPath,['scripts/artifact-publication.mjs','--manifest',path.join(out,'artifacts.json'),'--plan',selectedPlan,'--event',event,'--output',dryRun],source,env);
   assert.deepEqual(JSON.parse(await readFile(dryRun)).artifacts.map(a=>a.name),[name]);
  }
  const tree=git('ls-tree','-rz','--full-tree',commit).toString().split('\0').filter(Boolean);
  for(const entry of tree){const [meta,file]=entry.split('\t'),[mode,,blob]=meta.split(' ');assert.ok((await readFile(path.join(source,file))).equals(git('cat-file','blob',blob)),`Source changed ${file}`);assert.equal((await lstat(path.join(source,file))).mode&0o777,mode==='100755'?0o755:0o644);}
  assert.equal(execFileSync('git',['-C',source,'diff','--binary','HEAD']).length,0);record.sourceRestored=true;record.status='passed';
 } finally {
  const cleanupErrors=[];const clean=(label,fn)=>{try{fn();}catch(error){cleanupErrors.push({label,message:error.message});}};
  // A failed multi-image build may not have written its manifest. Inspect only
  // the exact task source prefix and verify OCI revision before deleting tags.
  const taskTags=execFileSync('docker',['image','ls','--filter',`reference=section10-${commit.slice(0,12)}-*`,'--format','{{.Repository}}:{{.Tag}}']).toString().trim().split('\n').filter(Boolean);
  for(const tag of taskTags)clean(tag,()=>{assert.equal(execFileSync('docker',['image','inspect',tag,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}']).toString().trim(),commit);execFileSync('docker',['image','rm',tag]);});
  for(const version of ['old','new'])clean('inspection-'+version,()=>{const tag=`section10-inspect-${round}-${version}`;if(spawnSync('docker',['image','inspect',tag]).status===0)execFileSync('docker',['image','rm',tag]);});
  if(builderCreated)clean('builder',()=>execFileSync('docker',['buildx','rm',builderCreated]));
  for(const name of [database,test])clean(name,()=>execFileSync('dropdb',['--if-exists','-h','127.0.0.1','-U','course',name],{env}));
  record.cleanupErrors=cleanupErrors;
  record.cleanup={taskContainersAbsent:!execFileSync('docker',['ps','-a','--filter','label=course.task=section10','--format','{{.Names}}']).length,taskNetworksAbsent:!execFileSync('docker',['network','ls','--filter','label=course.task=section10','--format','{{.Name}}']).length};assert.ok(Object.values(record.cleanup).every(Boolean));
  records.push(record);await writeFile(path.join(evidence,'results.json'),JSON.stringify({round,platform:process.platform,cliCommit:'2dcd4dc53b9f40923f604f521fbf05453e83c376',deterministicBuilds:2,strictTreesVerified:8,privateSyntheticAncestry:true,externallyPublished:false,records},null,2));await rm(work,{recursive:true,force:true});assert.equal(cleanupErrors.length,0,'Cleanup failures recorded in results.json');
 }
}
await rm(root,{recursive:true,force:true});
