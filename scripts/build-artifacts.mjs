import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const exec=promisify(execFile);
const names=['admin','api','migrations','storefront'];
const args=process.argv.slice(2),value=f=>args[args.indexOf(f)+1];
if(!args.includes('--plan')||!args.includes('--output'))throw new Error('Required --plan <json> --output <new directory>');
const selection=JSON.parse(await readFile(value('--plan'),'utf8'));
if(!Array.isArray(selection.deployables)||selection.deployables.some(n=>!names.includes(n))||new Set(selection.deployables).size!==selection.deployables.length)throw new Error('Invalid deployable selection');
const sourceRoot=(await exec('git',['rev-parse','--show-toplevel'])).stdout.trim();
if(await realpath(sourceRoot)!==await realpath(process.cwd()))throw new Error('Build from the project Git root; recovered sources need their own prepared Git history');
const output=path.resolve(value('--output'));await mkdir(output); // refuse overwrite
const sourceCommit=(await exec('git',['rev-parse','HEAD'])).stdout.trim();
const buildTime=new Date().toISOString();
const context=await mkdtemp(path.join(tmpdir(),'section10-build-'));
const artifacts=[];
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
try {
 const sourceTar=path.join(context,'source.tar');await exec('git',['archive','--format=tar',`--output=${sourceTar}`,sourceCommit]);
 const source=path.join(context,'source');await mkdir(source);await exec('tar',['-xf',sourceTar,'-C',source]);
 for(const name of selection.deployables) {
  const tag=`section10-${sourceCommit.slice(0,12)}-${name}-${process.pid}`;
  const dockerfile=name==='migrations'?'prisma/Dockerfile':`apps/${name}/Dockerfile`;
  const buildArgs=['buildx','build','--load','-f',path.join(source,dockerfile),'--build-arg',`SOURCE_COMMIT=${sourceCommit}`,'--build-arg',`BUILD_TIME=${buildTime}`,'-t',tag];
  if(args.includes('--no-cache'))buildArgs.push('--no-cache');
  const build=await exec('docker',[...buildArgs,source],{maxBuffer:100*1024*1024});
  await writeFile(path.join(output,`${name}.build.log`),build.stdout+build.stderr);
  const image=JSON.parse((await exec('docker',['image','inspect',tag])).stdout)[0];
  const labels=image.Config.Labels;
  if(labels['org.opencontainers.image.revision']!==sourceCommit||labels['course.artifact']!==name||labels['org.opencontainers.image.created']!==buildTime||labels['course.toolchain']!=='node24.18.0-pnpm11.17.0'||labels['org.opencontainers.image.source']!=='https://github.com/madeupdev/advanced-monorepos-project')throw new Error(`Image provenance mismatch ${name}`);
  const archive=path.join(output,`${name}.docker.tar`);await exec('docker',['save','-o',archive,image.Id],{maxBuffer:1024*1024});
  artifacts.push({name,sourceCommit,imageId:image.Id,archiveSha256:await digest(archive),archive:path.basename(archive),buildTime,source:labels['org.opencontainers.image.source'],toolchain:labels['course.toolchain'],status:'staged',tag});
  process.stdout.write(`Staged ${name} ${image.Id}; no external publication\n`);
 }
 await writeFile(path.join(output,'artifacts.json'),JSON.stringify({sourceCommit,format:'docker-save archive; imageId is a local OCI image config digest, not a registry manifest digest',artifacts},null,2)+'\n');
} finally {await rm(context,{recursive:true,force:true});}
