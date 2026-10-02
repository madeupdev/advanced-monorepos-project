import {execFileSync} from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectWorkspace } from './workspace-conventions.mjs';
export function planUpgrade(graph,dependency,sourceOwners) {
 const target=`npm:${dependency}`;
 if(sourceOwners?.some(name=>!graph.nodes[name]))throw new Error('Source import owner missing from graph');
 const directImporters=sourceOwners ? [...new Set(sourceOwners)].sort() : Object.keys(graph.nodes).filter(name=>(graph.dependencies[name]??[]).some(edge=>edge.target===target)).sort();
 if(!directImporters.length)throw new Error(`Dependency ${dependency} is not discovered in the project graph`);
 const impacted=new Set(directImporters);let changed=true;
 while(changed){changed=false;for(const name of Object.keys(graph.nodes))if(!impacted.has(name)&&(graph.dependencies[name]??[]).some(edge=>impacted.has(edge.target))){impacted.add(name);changed=true;}}
 const impactedProjects=[...impacted].sort();
 const ordinaryTargets=impactedProjects.flatMap(name=>['typecheck','build'].filter(t=>graph.nodes[name].data.targets?.[t]).map(t=>`${name}:${t}`));
 return {dependency,directImporters,impactedProjects,ordinaryTargets,globalGates:['pnpm lint','pnpm test:tooling'],versionChanged:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const dependency=process.argv[2]??'zod';if(dependency!=='zod')throw new Error('Prepared scenario supports zod only');
 const {graph}=inspectWorkspace();
 const sourceFiles=execFileSync('git',['ls-files','-z','apps','libs']).toString().split('\0').filter(f=>/\.(ts|tsx|mjs|cjs)$/.test(f));
 const importFiles=sourceFiles.filter(f=>/from\s+['"]zod['"]|import\(['"]zod['"]\)/.test(readFileSync(f,'utf8')));
 const sourceOwners=importFiles.map(file=>Object.entries(graph.nodes).filter(([,n])=>file.startsWith(n.data.root+'/')).sort((a,b)=>b[1].data.root.length-a[1].data.root.length)[0]?.[0]);
 const plan=planUpgrade(graph,dependency,sourceOwners);
 const require=createRequire(path.join(process.cwd(),'package.json'));
 const installed=JSON.parse(readFileSync(require.resolve('zod/package.json'),'utf8')).version;
 console.log(JSON.stringify({...plan,importFiles,impactEvidence:'Direct source imports plus actual internal Nx graph; this workspace omits npm external nodes',installedVersion:installed,candidate:'A reviewed Zod 4.x patch/minor; select an exact version before implementation',compatibilitySources:['https://zod.dev/v4/changelog','https://github.com/colinhacks/zod/releases'],compatibilityQuestions:['schema parsing and safeParse errors','inferred contract types','browser/server environment validation','old/new HTTP consumer payload compatibility'],protectedSuites:['pnpm test:unit','pnpm test:api','pnpm test:e2e'],selectionPolicy:'Use scripts/ci-plan.mjs after an actual root manifest/lockfile change; root changes can conservatively require full validation.',rollback:'Revert the scoped manifest and lockfile change; no database schema changes proposed.'},null,2));
}
