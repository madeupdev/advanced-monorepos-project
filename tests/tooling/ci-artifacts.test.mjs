import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const moduleUrl = new URL('../../scripts/ci-artifacts.mjs', import.meta.url);
const ready = existsSync(moduleUrl);
test('artifact scanner exists before diagnostics are retained', () => assert.ok(ready, 'Missing artifact scanner'));
for (const [label, value] of [['connection string','postgresql://user:password@host/db'],['assignment','API_TOKEN=privatevalue'],['GitHub token','ghp_abcdefghijklmnopqrstuvwxyz1234567890'],['private key','-----BEGIN PRIVATE KEY-----']]) {
  test(`rejects ${label} inside diagnostics`, { skip: !ready }, async () => {
    const dir = await mkdtemp(join(tmpdir(),'s09-artifact-test-'));
    try {
      await writeFile(join(dir,'report.txt'),value);
      const { auditArtifacts } = await import(moduleUrl);
      await assert.rejects(auditArtifacts([dir]), /sensitive|secret/i);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
}
test('accepts safe diagnostic evidence and absent optional paths', { skip: !ready }, async () => {
  const dir = await mkdtemp(join(tmpdir(),'s09-artifact-test-'));
  try {
    await mkdir(join(dir,'nested'));
    await writeFile(join(dir,'nested','error-context.md'),'Expected heading missing; local: pnpm test:e2e');
    const { auditArtifacts } = await import(moduleUrl);
    const result = await auditArtifacts([dir,join(dir,'absent')]);
    assert.equal(result.files,1);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('inspects expanded trace entries before retention', { skip: !ready }, async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(),'s09-trace-test-'));
  try {
    await writeFile(join(dir,'trace.txt'),'API_TOKEN=embedded-private-value');
    execFileSync('zip',['-q',join(dir,'trace.zip'),'trace.txt'],{cwd:dir});
    await rm(join(dir,'trace.txt'));
    const { auditArtifacts } = await import(moduleUrl);
    await assert.rejects(auditArtifacts([join(dir,'trace.zip')]), /Sensitive/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('rejects quoted credential keys and values in JSON reports and zipped traces', async () => {
  const {execFileSync}=await import('node:child_process');
  const dir=await mkdtemp(join(tmpdir(),'s09-json-secret-'));
  try {
    const report=join(dir,'report.json');
    await writeFile(report,JSON.stringify({api_key:'private-value',token:'secret-value',password:'hidden-value'}));
    const {auditArtifacts}=await import(moduleUrl);
    await assert.rejects(auditArtifacts([report]),/Sensitive/);
    execFileSync('zip',['-q',join(dir,'trace.zip'),'report.json'],{cwd:dir});
    await rm(report);
    await assert.rejects(auditArtifacts([join(dir,'trace.zip')]),/Sensitive/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('HTML report JavaScript variable defaults are not mistaken for credentials', async () => {
  const dir=await mkdtemp(join(tmpdir(),'s09-html-report-'));
  try {
    const file=join(dir,'index.html');
    await writeFile(file,'<script>function unzip({password=e}={}) { return password; }</script>');
    const {auditArtifacts}=await import(moduleUrl);
    assert.equal((await auditArtifacts([file])).files,1);
    await writeFile(file,'<script>const config={"password":"private-secret-value"}</script>');
    await assert.rejects(auditArtifacts([file]),/Sensitive/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('HTML embedded Playwright ZIP data is audited after decoding', async () => {
  const {execFileSync}=await import('node:child_process');
  const {readFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'s09-html-zip-'));
  try {
    await writeFile(join(dir,'report.json'),JSON.stringify({token:'private-secret-value'}));
    execFileSync('zip',['-q',join(dir,'report.zip'),'report.json'],{cwd:dir});
    const data=(await readFile(join(dir,'report.zip'))).toString('base64');
    const html=join(dir,'index.html');
    await writeFile(html,`<template id="playwrightReportBase64">data:application/zip;base64,${data}</template>`);
    const {auditArtifacts}=await import(moduleUrl);
    await assert.rejects(auditArtifacts([html]),/Sensitive/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
