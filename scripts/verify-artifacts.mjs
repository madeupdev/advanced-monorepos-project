import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile } from 'node:fs/promises';
import { verifyStaged } from './artifact-publication.mjs';
import path from 'node:path';
const exec=promisify(execFile),docker=async(...args)=>(await exec('docker',args,{maxBuffer:10*1024*1024})).stdout.trim();
const args=process.argv.slice(2),value=f=>args[args.indexOf(f)+1];
for(const f of ['--manifest','--output'])if(!args.includes(f))throw new Error(`${f} required`);
const manifest=JSON.parse(await readFile(value('--manifest'),'utf8'));
await verifyStaged(manifest,path.dirname(path.resolve(value('--manifest'))));
const artifacts=Object.fromEntries(manifest.artifacts.map(a=>[a.name,a]));
for(const name of ['api','admin','storefront','migrations'])if(!artifacts[name])throw new Error(`Runtime suite requires all four images: missing ${name}`);
const task=`section10-runtime-${process.pid}`,network=task,db=task+'-db',api=task+'-api',admin=task+'-admin',storefront=task+'-storefront';
const containers=[],checks={};let net=false,result;
async function run(name,options,image){await docker('run','-d','--name',name,'--label','course.task=section10','--network',network,...options,image);containers.push(name);}
async function wait(name,command){for(let i=0;i<60;i++){try{return await docker('exec',name,...command);}catch{await new Promise(r=>setTimeout(r,500));}}throw new Error(`Runtime not ready ${name}`);}
try {
 await docker('network','create','--label','course.task=section10',network);net=true;
 await run(db,['--network-alias','database','-e','POSTGRES_DB=runtime','-e','POSTGRES_PASSWORD=fixture'],'postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f');
 await wait(db,['pg_isready','-U','postgres','-d','runtime']);
 const databaseUrl='postgresql://postgres:fixture@database:5432/runtime';
 const migration=await docker('run','--rm','--network',network,'-e',`DATABASE_URL=${databaseUrl}`,artifacts.migrations.imageId);
 if(!/applied|No pending migrations/.test(migration))throw new Error('Migration command did not report application');checks.migrationExecuted=true;
 await run(api,['--network-alias','api','-e',`DATABASE_URL=${databaseUrl}`],artifacts.api.imageId);
 const health=await wait(api,['node','-e',"fetch('http://127.0.0.1:3333/api/health').then(async r=>{if(r.status!==200)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))"]);
 checks.apiHealth=JSON.parse(health).status==='ok';
 const catalogue=await docker('exec',api,'node','-e',"fetch('http://127.0.0.1:3333/api/titles').then(async r=>{if(r.status!==200)process.exit(1);console.log(await r.text())})");checks.apiDatabaseQuery=Array.isArray(JSON.parse(catalogue).titles);
 await run(storefront,['-e','API_URL=http://api:3333'],artifacts.storefront.imageId);
 await wait(storefront,['node','-e',"fetch('http://127.0.0.1:3000').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]);
 checks.storefrontStartup=true;
 const html=await docker('exec',storefront,'node','-e',"fetch('http://127.0.0.1:3000').then(r=>r.text()).then(console.log)");
 const staticPath=html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1];if(!staticPath)throw new Error('No storefront static asset');
 await docker('exec',storefront,'node','-e',`fetch(new URL(${JSON.stringify(staticPath)},'http://127.0.0.1:3000')).then(r=>process.exit(r.status===200?0:1))`);checks.storefrontStaticAsset=true;
 await run(admin,[],artifacts.admin.imageId);
 await wait(admin,['wget','-qO-','http://127.0.0.1:8080/health']);
 const deep=await docker('exec',admin,'wget','-qO-','http://127.0.0.1:8080/catalogue/old-browser-tab');checks.adminDeepLink=deep.includes('<div id="root">');
 const asset=deep.match(/src="([^" ]*\/assets\/[^" ]+)"/)?.[1];if(!asset)throw new Error('No admin static asset');
 await docker('exec',admin,'wget','-qO-','http://127.0.0.1:8080'+asset);checks.adminStaticAsset=true;
 for(const name of [api,storefront,admin])await docker('exec',name,'sh','-c','test ! -e /app/.env && test ! -e /app/.git && test ! -e /usr/share/nginx/html/.env');checks.noLocalCredentials=true;
 if(Object.values(checks).some(v=>v!==true))throw new Error('Runtime assertion failed');
 result={sourceCommit:manifest.sourceCommit,checks,artifactIds:manifest.artifacts.map(a=>({name:a.name,imageId:a.imageId})),platform:process.platform};
} finally {
 for(const name of containers.reverse())await docker('rm','-f',name);
 if(net)await docker('network','rm',network);
 if(result){result.cleanup={containersRemoved:!(await docker('ps','-a','--filter',`name=${task}`,'--format','{{.Names}}')),networkRemoved:!(await docker('network','ls','--filter',`name=${task}`,'--format','{{.Name}}'))};await writeFile(value('--output'),JSON.stringify(result,null,2)+'\n');}
}
