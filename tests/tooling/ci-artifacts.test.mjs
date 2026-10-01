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

test('accepts reporter JavaScript and source snippets inside structured evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's09-code-evidence-'));
  try {
    const code = 'function unzip({password=e}={}) { return {password:decode(e)}; } const config={password:!0};';
    await writeFile(join(dir, 'reporter.js'), code);
    await writeFile(join(dir, 'report.json'), JSON.stringify({ snippet: code }));
    await writeFile(join(dir, 'reporter.css'), '.codicon-gist-secret:before{content:"icon"}');
    const { auditArtifacts } = await import(moduleUrl);
    assert.equal((await auditArtifacts([dir])).files, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('accepts the loopback Vite WebSocket nonce but rejects remote and HTTP token URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's09-network-evidence-'));
  try {
    const file = join(dir, '0-trace.network');
    const { auditArtifacts } = await import(moduleUrl);
    await writeFile(file, JSON.stringify({ request: { url: 'ws://127.0.0.1:3219/?token=IP47C2sYh2Aj', cookies: [], headers: [{ name: 'Sec-WebSocket-Protocol', value: 'vite-hmr' }], queryString: [{ name: 'token', value: 'IP47C2sYh2Aj' }] } }));
    assert.equal((await auditArtifacts([file])).files, 1);
    await writeFile(file, JSON.stringify({ request: { url: 'ws://127.0.0.1:3219/?token=IP47C2sYh2Aj', headers: [{ name: 'Sec-WebSocket-Protocol', value: 'vite-hmr' }], queryString: [{ name: 'token', value: 'different-private-value' }] } }));
    await assert.rejects(auditArtifacts([file]), /Sensitive/);
    for (const url of ['wss://remote.example/?token=private-value', 'https://127.0.0.1/?token=private-value', 'ws://127.0.0.1/private?token=private-value', 'ws://127.0.0.1/?token=IP47C2sYh2Aj']) {
      await writeFile(file, JSON.stringify({ request: { url } }));
      await assert.rejects(auditArtifacts([file]), /Sensitive/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects trace authentication headers and cookies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's09-auth-evidence-'));
  try {
    const file = join(dir, '0-trace.network');
    const { auditArtifacts } = await import(moduleUrl);
    for (const request of [
      { headers: [{ name: 'Authorization', value: 'Bearer private-value' }] },
      { headers: [{ name: 'Cookie', value: 'session=private-value' }] },
      { cookies: [{ name: 'session', value: 'private-value' }] },
    ]) {
      await writeFile(file, JSON.stringify({ request }));
      await assert.rejects(auditArtifacts([file]), /Sensitive/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects literal credentials and known secrets inside JSON source snippets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's09-source-secret-'));
  const previous = process.env.PGPASSWORD;
  process.env.PGPASSWORD = 'known-private-diagnostic-value';
  try {
    const file = join(dir, 'report.json');
    const { auditArtifacts } = await import(moduleUrl);
    for (const snippet of ['const token="private-value";', 'const DATABASE_URL="postgresql://user:password@host/db";', 'known-private-diagnostic-value']) {
      await writeFile(file, JSON.stringify({ snippet }));
      await assert.rejects(auditArtifacts([file]), /Sensitive/);
    }
  } finally {
    if (previous === undefined) delete process.env.PGPASSWORD; else process.env.PGPASSWORD = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('known environment secrets are rejected before the public nonce exception', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's09-known-nonce-'));
  const previous = process.env.PGPASSWORD;
  process.env.PGPASSWORD = 'IP47C2sYh2Aj';
  try {
    const file = join(dir, '0-trace.network');
    await writeFile(file, JSON.stringify({ request: { url: 'ws://127.0.0.1:3219/?token=IP47C2sYh2Aj', headers: [{ name: 'Sec-WebSocket-Protocol', value: 'vite-hmr' }] } }));
    const { auditArtifacts } = await import(moduleUrl);
    await assert.rejects(auditArtifacts([file]), /Sensitive/);
  } finally {
    if (previous === undefined) delete process.env.PGPASSWORD; else process.env.PGPASSWORD = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
