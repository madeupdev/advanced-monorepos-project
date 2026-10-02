import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const artifacts=['admin','api','migrations','storefront'];
export async function selectDeployables({files,cwd=process.cwd(),full=false}) {
 if(!Array.isArray(files) || files.some(f=>typeof f!=='string'||!f||/[\n\r,\\]/.test(f)||path.isAbsolute(f)||f.split('/').some(p=>p==='..'||p==='.'||!p))) throw new Error('Invalid changed file path');
 const temp=await mkdtemp(path.join(tmpdir(),'deployables-'));
 try {
  const graphFile=path.join(temp,'graph.json');
  await exec(process.execPath,[path.join(cwd,'node_modules/nx/dist/bin/nx.js'),'graph',`--file=${graphFile}`],{cwd,maxBuffer:20*1024*1024,env:{...process.env,NX_DAEMON:'false',NX_NO_CLOUD:'true',NX_PREFER_NODE_STRIP_TYPES:'false',NX_CACHE_DIRECTORY:path.join(temp,'cache'),NX_WORKSPACE_DATA_DIRECTORY:path.join(temp,'workspace'),NODE_PATH:[path.join(cwd,'node_modules/nx/node_modules'),path.join(cwd,'node_modules'),path.join(cwd,'node_modules/.pnpm/node_modules')].join(path.delimiter)}});
  const {graph}=JSON.parse(await readFile(graphFile,'utf8'));
  for(const app of ['admin','api','storefront']) if(!graph.nodes[`@madeup-video/${app}`]) throw new Error(`Missing deployable ${app} in dependency graph`);
  const selected=new Set(); const changed=new Set(); let conservative=full;
  for(const file of files) {
   if(/^prisma\/migrations\//.test(file)) {selected.add('migrations');continue;}
   if(file==='prisma/schema.prisma'||file==='prisma.config.ts') {for(const a of ['api','storefront','migrations'])selected.add(a);continue;}
   if(file==='README.md'||file==='LICENSE.md'||file.startsWith('docs/'))continue;
   const owners=Object.entries(graph.nodes).filter(([,n])=>n.data.root && (file===n.data.root||file.startsWith(`${n.data.root}/`))).sort((a,b)=>b[1].data.root.length-a[1].data.root.length);
   if(owners.length)changed.add(owners[0][0]); else conservative=true;
  }
  let expanded=true;
  while(expanded) {expanded=false;for(const [source,deps] of Object.entries(graph.dependencies))if(!changed.has(source)&&deps.some(d=>changed.has(d.target))){changed.add(source);expanded=true;}}
  for(const app of ['admin','api','storefront']) if(changed.has(`@madeup-video/${app}`))selected.add(app);
  return {files:[...files],deployables:conservative?artifacts:[...selected].sort(),reason:conservative?'global or unknown build input; conservative full selection':'dependency graph closure plus explicit database policy'};
 } finally {await rm(temp,{recursive:true,force:true});}
}
export async function comparisonFiles(base,head,cwd=process.cwd()) {
 if(!/^[a-f0-9]{40}$/.test(base??'')||!/^[a-f0-9]{40}$/.test(head??''))throw new Error('Comparison range requires full verified commit SHAs');
 try {for(const ref of [base,head]) await exec('git',['cat-file','-e',`${ref}^{commit}`],{cwd}); await exec('git',['merge-base','--is-ancestor',base,head],{cwd});}
 catch {throw new Error('Invalid comparison range: missing commit or base is not an ancestor of head');}
 return (await exec('git',['diff','--name-only','-z',base,head],{cwd})).stdout.split('\0').filter(Boolean);
}
async function main(args) {
 const at=args.indexOf('--files'); const full=args.includes('--full')||process.env.CI_FULL==='true';
 const files=at>=0?(args[at+1]?args[at+1].split(','):[]):full?[]:await comparisonFiles(process.env.CI_BASE,process.env.CI_HEAD);
 const plan=await selectDeployables({files,full}); const json=JSON.stringify(plan,null,2)+'\n';
 const out=args.indexOf('--output');if(out>=0)await writeFile(args[out+1],json);process.stdout.write(json);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
