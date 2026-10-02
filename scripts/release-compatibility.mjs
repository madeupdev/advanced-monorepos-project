import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args,{maxBuffer:20*1024*1024})).stdout.trim();
const task=`section10-compat-${process.pid}`;
const network=task;const db=`${task}-db`;const old=`${task}-old`;const fresh=`${task}-new`;
const matrix=[];const containers=[];let networkCreated=false;
const output=process.argv[process.argv.indexOf('--output')+1];
if(!process.argv.includes('--output'))throw new Error('--output is required');
const sql=async statement=>docker('exec',db,'psql','-U','postgres','-d','compatibility','-v','ON_ERROR_STOP=1','-c',statement);
const probe=async name=>JSON.parse(await docker('exec',name,'node','-e',`fetch('http://127.0.0.1:8080').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`));
async function ready(name,args){for(let i=0;i<60;i++){try{return await docker('exec',name,...args);}catch{await new Promise(r=>setTimeout(r,500));}}throw new Error(`Not ready ${name}`);}
async function observe(stage){const a=await probe(old),b=await probe(fresh);matrix.push({stage,old:a.status,new:b.status,oldErrorCode:a.body.code,oldBody:a.body,newBody:b.body});}
let result;
try {
 await docker('network','create','--label','course.task=section10',network);networkCreated=true;
 await docker('run','-d','--name',db,'--network',network,'--label','course.task=section10','-e','POSTGRES_PASSWORD=fixture','-e','POSTGRES_DB=compatibility','postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f');containers.push(db);
 await ready(db,['pg_isready','-U','postgres','-d','compatibility']);
 await sql("CREATE TABLE release_names (id integer PRIMARY KEY, legacy_name text NOT NULL); INSERT INTO release_names VALUES (1,'Original title');");
 const base=process.env.SECTION10_API_IMAGE||'section10-l01-api';
 const baseId=JSON.parse(await docker('image','inspect',base))[0].Id;
 const fixtureImages={};
 for(const [version,name] of [['old',old],['new',fresh]]) {
  const tag=`${task}-${version}-image`;
  await docker('build','-f','fixtures/release-compatibility/Dockerfile','--build-arg',`API_IMAGE=${baseId}`,'--build-arg',`FIXTURE_VERSION=${version}`,'-t',tag,'.');
  fixtureImages[version]=JSON.parse(await docker('image','inspect',tag))[0].Id;
  await docker('run','-d','--name',name,'--network',network,'--label','course.task=section10','-e',`DATABASE_URL=postgresql://postgres:fixture@${db}:5432/compatibility`,tag);containers.push(name);
  await ready(name,['node','-e',"fetch('http://127.0.0.1:8080').then(()=>process.exit(0)).catch(()=>process.exit(1))"]);
 }
 await observe('initial');
 await sql('ALTER TABLE release_names RENAME COLUMN legacy_name TO display_name');await observe('unsafe-rename');
 await sql('ALTER TABLE release_names RENAME COLUMN display_name TO legacy_name');await observe('restored');
 await sql('ALTER TABLE release_names ADD COLUMN display_name text; UPDATE release_names SET display_name=legacy_name; ALTER TABLE release_names ALTER COLUMN display_name SET NOT NULL');await observe('expanded');
 await sql('ALTER TABLE release_names DROP COLUMN legacy_name');await observe('contracted');
 await sql('ALTER TABLE release_names ADD COLUMN legacy_name text; UPDATE release_names SET legacy_name=display_name; ALTER TABLE release_names ALTER COLUMN legacy_name SET NOT NULL');await observe('safe-restored');
 result={fixture:'read-only name contract; not a product schema change',baseImageId:baseId,fixtureImages,matrix,sourceRestored:true,contractionObservation:'No old readers or writers; backfill verified; rollback window deliberately closed',rollback:'Old API cannot roll back after contraction without schema repair'};
} finally {
 for(const name of containers.reverse())await docker('rm','-f',name);
 if(networkCreated)await docker('network','rm',network);
 if(result){result.cleanup={containersRemoved:!(await docker('ps','-a','--filter',`name=${task}`,'--format','{{.Names}}')),networkRemoved:!(await docker('network','ls','--filter',`name=${task}`,'--format','{{.Name}}'))};await writeFile(output,JSON.stringify(result,null,2)+'\n');}
}
