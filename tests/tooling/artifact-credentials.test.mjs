import assert from 'node:assert/strict';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import * as publication from '../../scripts/artifact-publication.mjs';
const exec=promisify(execFile);
const docker=async(...args)=>(await exec('docker',args)).stdout.trim();
test('a migrations-only selection must inspect its filesystem and propagate failure',async()=>{
 assert.equal(typeof publication.verifyNoLocalCredentials,'function');
 const calls=[];
 await assert.rejects(()=>publication.verifyNoLocalCredentials([{name:'migrations',imageId:'migration-image'}],async(...args)=>{calls.push(args);throw new Error('credential present');}),/credential present/);
 assert.equal(calls.length,1);
 assert.ok(calls[0].includes('migration-image'));
 assert.ok(calls[0].includes('--entrypoint'));
});
test('real image checks reject each forbidden filesystem input', {skip:!process.env.SECTION10_CREDENTIAL_CHECK},async()=>{
 assert.equal(typeof publication.verifyNoLocalCredentials,'function');
 const base='node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d';
 await publication.verifyNoLocalCredentials([{name:'migrations',imageId:base}],docker);
 for(const [index,file] of ['/app/.env','/app/.git','/usr/share/nginx/html/.env'].entries()) {
  const tag=`section10-review-credential-${process.pid}-${index}`;
  try {
   await new Promise((resolve,reject)=>{
     const child=spawn('docker',['build','--quiet','--tag',tag,'-'],{stdio:['pipe','pipe','pipe']});
     let stderr='';child.stdout.resume();child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(stderr)));
     child.stdin.end(`FROM ${base}\nRUN mkdir -p /app /usr/share/nginx/html && touch ${file}\nENTRYPOINT ["false"]\n`);
   });
   await assert.rejects(()=>publication.verifyNoLocalCredentials([{name:'migrations',imageId:tag}],docker));
  } finally {await docker('image','rm',tag);}
 }
});
