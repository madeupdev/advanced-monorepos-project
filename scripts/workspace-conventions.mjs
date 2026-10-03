import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const originalLibraries = new Set(['contracts','rental-domain','database','ui','testing'].map(n=>`@madeup-video/${n}`));
const runtimes = { app: ['universal','browser','server'], contract:['universal'], domain:['universal'], 'data-access':['server'], ui:['browser'], test:['server','browser'], tooling:['server'] };
export function validateMetadata({nodes,aliases,entries}) {
  const issues=[];
  for(const [name,node] of Object.entries(nodes)) {
    const d=node.data ?? node, tags=d.tags ?? [];
    if(JSON.stringify(d.metadata?.owners)!==JSON.stringify(['robdonn'])) issues.push(`${name}: verified owner is required`);
    const dimensions={};
    for(const [dimension,allowed] of Object.entries({type:Object.keys(runtimes),runtime:['universal','browser','server'],scope:['rental','shared','storefront','workspace']})) {
      const values=tags.filter(t=>t.startsWith(`${dimension}:`)).map(t=>t.slice(dimension.length+1));
      if(values.length!==1||!allowed.includes(values[0])) issues.push(`${name}: exactly one supported ${dimension} tag is required`);
      else dimensions[dimension]=values[0];
    }
    if(dimensions.type && dimensions.runtime && !runtimes[dimensions.type].includes(dimensions.runtime)) issues.push(`${name}: unsupported type/runtime combination`);
    if(d.root?.startsWith('libs/')) {
      const entry=`${d.sourceRoot}/index.ts`;
      if(!entries.includes(entry)) issues.push(`${name}: public entry missing`);
      if(JSON.stringify(aliases[name])!==JSON.stringify([`./${entry}`])) issues.push(`${name}: source alias must resolve only to the public entry`);
      if(!originalLibraries.has(name)) for(const target of ['test','typecheck']) {
        const t=d.targets?.[target],command=t?.options?.command;
        const supported=target==='test' ? t?.cache===false && /^node --import tsx --test libs\/[a-z][a-z0-9-]*\/.*\.test\.ts$/.test(command??'') : /^node node_modules\/typescript\/bin\/tsc --noEmit -p libs\/[a-z][a-z0-9-]*\/tsconfig\.json$/.test(command??'');
        if(t?.executor!=='nx:run-commands'||!supported) issues.push(`${name}: supported ${target} target required`);
      }
    }
  }
  for(const name of Object.keys(aliases)) if(name.startsWith('@madeup-video/')&&!nodes[name]) issues.push(`${name}: orphan alias`);
  return issues;
}
export function inspectWorkspace(cwd=process.cwd()) {
  const require=createRequire(path.join(cwd,'package.json'));
  const stdout=execFileSync(process.execPath,[require.resolve('nx/bin/nx'),'graph','--file=stdout'],{cwd,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NODE_PATH:[path.join(cwd,'node_modules/nx/node_modules'),path.join(cwd,'node_modules'),path.join(cwd,'node_modules/.pnpm/node_modules'),process.env.NODE_PATH].filter(Boolean).join(path.delimiter),NX_DAEMON:'false',NX_NO_CLOUD:'true',NX_PREFER_NODE_STRIP_TYPES:'false'}});
  const graph=JSON.parse(stdout).graph;
  const aliases=JSON.parse(readFileSync(path.join(cwd,'tsconfig.base.json'),'utf8')).compilerOptions.paths;
  const entries=Object.values(graph.nodes).map(n=>`${n.data.sourceRoot}/index.ts`).filter(p=>existsSync(path.join(cwd,p)));
  return {graph,issues:validateMetadata({nodes:graph.nodes,aliases,entries})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {issues}=inspectWorkspace();
  if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}
  else console.log('Workspace ownership, metadata and source-entry conventions pass.');
}
