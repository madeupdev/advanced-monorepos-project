import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const repository='madeupdev/advanced-monorepos-project';
const names=['admin','api','migrations','storefront'];
export function authorizeEvent(event,source) {
 if(!['workflow_dispatch','push'].includes(event?.name)||event.repository!==repository||!/^refs\/heads\/(main|codex\/section-10[-/a-z0-9]*)$/.test(event.ref??'')||event.sha!==source||event.mode!=='dry-run')throw new Error('Unauthorized artifact event; only same-repository approved-branch dispatch dry-run is supported');
 return true;
}
export function publicationPlan({manifest,selection,event}) {
 const source=manifest?.sourceCommit;if(!/^[a-f0-9]{40}$/.test(source??''))throw new Error('Invalid source metadata');
 authorizeEvent(event,source);
 if(!Array.isArray(manifest.artifacts)||!Array.isArray(selection?.deployables))throw new Error('Invalid artifact metadata');
 const found=new Map();
 for(const a of manifest.artifacts) {
  if(!names.includes(a.name))throw new Error('Unknown artifact');
  if(found.has(a.name))throw new Error('Duplicate artifact');
  if(a.sourceCommit!==source||a.source!==`https://github.com/${repository}`||a.toolchain!=='node24.18.0-pnpm11.17.0'||!/^sha256:[a-f0-9]{64}$/.test(a.imageId??'')||!/^[a-f0-9]{64}$/.test(a.archiveSha256??'')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(a.buildTime??'')||!Number.isFinite(Date.parse(a.buildTime))||a.status!=='staged')throw new Error(`Invalid metadata or inconsistent provenance: ${a.name}`);
  found.set(a.name,a);
 }
 if(new Set(selection.deployables).size!==selection.deployables.length)throw new Error('Duplicate deployable selection');
 return {status:'dry-run',externallyPublished:false,sourceCommit:source,artifacts:selection.deployables.map(name=>{if(!names.includes(name))throw new Error(`Unknown deployable ${name}`);if(!found.has(name))throw new Error(`Missing selected artifact ${name}`);return found.get(name);})};
}
export async function verifyStaged(manifest,directory) {
 for(const artifact of manifest.artifacts) {
  if(artifact.archive!==`${artifact.name}.docker.tar`)throw new Error('Invalid archive path');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path.join(directory,artifact.archive)))hash.update(chunk);
  if(hash.digest('hex')!==artifact.archiveSha256)throw new Error(`Staged archive digest mismatch: ${artifact.name}`);
  const archive=path.join(directory,artifact.archive);
  const run=promisify(execFile);
  const entries=JSON.parse((await run('tar',['-xOf',archive,'manifest.json'],{maxBuffer:1024*1024})).stdout);
  if(!Array.isArray(entries)||entries.length!==1||!Array.isArray(entries[0].Layers))throw new Error('Invalid archive image manifest');
  const configPath=entries[0].Config;
  if(!/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(configPath??''))throw new Error('Invalid archive image config path');
  const configBytes=(await run('tar',['-xOf',archive,configPath],{encoding:'buffer',maxBuffer:1024*1024})).stdout;
  if('sha256:'+createHash('sha256').update(configBytes).digest('hex')!==artifact.imageId)throw new Error('Staged archive image identity mismatch');
  const config=JSON.parse(configBytes.toString('utf8'));
  const archivedLabels=config.config?.Labels;
  if(archivedLabels?.['org.opencontainers.image.revision']!==artifact.sourceCommit||archivedLabels?.['course.artifact']!==artifact.name||archivedLabels?.['org.opencontainers.image.created']!==artifact.buildTime||archivedLabels?.['course.toolchain']!==artifact.toolchain||archivedLabels?.['org.opencontainers.image.source']!==artifact.source)throw new Error('Staged archive provenance mismatch');
  if(entries[0].Layers.length!==config.rootfs?.diff_ids?.length)throw new Error('Invalid archive layer count');
  for(const [index,layer] of entries[0].Layers.entries()) {
   if(!/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\/layer\.tar)$/.test(layer))throw new Error('Invalid archive layer path');
   const child=spawn('tar',['-xOf',archive,layer]);const hash=createHash('sha256');
   const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Cannot read archived layer')));});
   child.stderr.resume();for await(const chunk of child.stdout)hash.update(chunk);await completion;
   if('sha256:'+hash.digest('hex')!==config.rootfs.diff_ids[index])throw new Error('Staged archive layer digest mismatch');
  }
  const image=JSON.parse((await promisify(execFile)('docker',['image','inspect',artifact.imageId])).stdout)[0];
  const labels=image.Config.Labels;
  if(image.Id!==artifact.imageId||labels['org.opencontainers.image.revision']!==artifact.sourceCommit||labels['org.opencontainers.image.created']!==artifact.buildTime||labels['course.artifact']!==artifact.name||labels['course.toolchain']!==artifact.toolchain||labels['org.opencontainers.image.source']!==artifact.source)throw new Error(`Image provenance mismatch: ${artifact.name}`);
 }
}
async function main(args){const value=flag=>args[args.indexOf(flag)+1];for(const f of ['--manifest','--plan','--event'])if(!args.includes(f)||!value(f))throw new Error('Required --manifest --plan --event');const [manifest,selection,event]=await Promise.all(['--manifest','--plan','--event'].map(async f=>JSON.parse(await readFile(value(f),'utf8'))));const plan=publicationPlan({manifest,selection,event});await verifyStaged(manifest,path.dirname(path.resolve(value('--manifest'))));const output=JSON.stringify(plan,null,2)+'\n';if(args.includes('--output'))await writeFile(value('--output'),output);process.stdout.write(output);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
