import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const patterns = [/postgres(?:ql)?:\/\/[^\s]+/i, /gh[pousr]_[a-z0-9]{20,}/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const credentialKey = /^(?:[a-z0-9]+[_-])*(?:password|secret|token|api[_-]?key)$/i;
const literalCredential = /\b(?:[a-z0-9]+[_-])*(?:password|secret|token|api[_-]?key)["']?\s*[=:]\s*["'][^"']+["']/i;
const environmentCredential = /\b(?:[A-Z0-9]+_)*(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*[^\s"']+/;
const plainCredential = /\b(?:[a-z0-9]+[_-])*(?:password|secret|token|api[_-]?key)["']?\s*[=:]\s*["']?[^\s"']+/i;
const urlCredential = /[?&](?:[a-z0-9]+[_-])*(?:password|secret|token|api[_-]?key)=[^&\s"']+/i;
const limit = 64 * 1024 * 1024;

function isViteDevelopmentSocket(request) {
  if (!Array.isArray(request.headers) || !request.headers.some(header => header.name?.toLowerCase() === 'sec-websocket-protocol' && header.value === 'vite-hmr')) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.hash
      && [...url.searchParams.keys()].join(',') === 'token' && /^[A-Za-z0-9_-]{12}$/.test(url.searchParams.get('token') ?? '')
      && (!Array.isArray(request.queryString) || request.queryString.every(item => item.name === 'token' && item.value === url.searchParams.get('token')));
  } catch { return false; }
}

function structuredEvidence(text, reject, secrets) {
  let records;
  try { records = [JSON.parse(text)]; } catch {
    try { records = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); } catch { return null; }
  }
  function visit(value, depth = 0) {
    if (depth > 100) throw new Error('Diagnostic structure depth limit exceeded');
    if (typeof value === 'string') {
      if ([...patterns, literalCredential, environmentCredential, urlCredential].some(pattern => pattern.test(value)) || secrets.some(secret => value.includes(secret))) reject();
      return;
    }
    if (!value || typeof value !== 'object') return;
    // Vite exposes this nonce in its public dev client. Only its root loopback
    // HMR handshake qualifies; remote, HTTP, and ordinary socket tokens fail.
    if (isViteDevelopmentSocket(value)) {
      value.url = value.url.split('?')[0];
      if (Array.isArray(value.queryString)) value.queryString = value.queryString.filter(item => item.name !== 'token');
    }
    if (typeof value.name === 'string' && typeof value.value === 'string' && value.value
      && (credentialKey.test(value.name) || /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(value.name))) reject();
    for (const [key, child] of Object.entries(value)) {
      if (credentialKey.test(key) && typeof child === 'string' && child) reject();
      if (key === 'cookies' && Array.isArray(child) && child.some(cookie => typeof cookie.value === 'string' && cookie.value)) reject();
      visit(child, depth + 1);
    }
  }
  for (const record of records) visit(record);
  return records.map(record => JSON.stringify(record)).join('\n');
}

export async function auditArtifacts(paths) {
  let files = 0;
  let bytes = 0;
  const secrets = ['OPENROUTER_API_KEY','GH_TOKEN','GITHUB_TOKEN','PGPASSWORD'].map(key => process.env[key]).filter(value => value?.length >= 8);
  function inspect(name, data) {
    bytes += data.length;
    if (bytes > limit) throw new Error('Diagnostic audit size limit exceeded');
    const text = data.toString('utf8');
    const reject = () => { throw new Error(`Sensitive diagnostic content rejected: ${name}`); };
    if (/^\.env(?:\.|$)/.test(basename(name)) || patterns.some(pattern => pattern.test(text)) || secrets.some(value => text.includes(value))) reject();
    const structured = structuredEvidence(text, reject, secrets);
    const evidence = structured ?? text;
    // Code defaults (password=e, token:this.tokenType) are expressions rather
    // than credentials. JSON fields are checked structurally, including headers.
    const code = /\.(?:html|[cm]?js|css)$/.test(name) || structured !== null;
    const activePatterns = [literalCredential, environmentCredential, urlCredential, ...(code ? [] : [plainCredential])];
    if (activePatterns.some(pattern => pattern.test(evidence))) reject();
  }
  async function walk(path) {
    let stat;
    try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Diagnostic symlinks are not retained');
    if (stat.isDirectory()) { for (const entry of await readdir(path)) await walk(join(path,entry)); return; }
    if (!stat.isFile() || stat.size > limit) throw new Error('Unsafe diagnostic file');
    const data = await readFile(path);
    inspect(path,data);
    files++;
    if (path.endsWith('.html')) {
      for (const match of data.toString('utf8').matchAll(/<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=\r\n]+)<\/template>/g)) {
        const directory = await mkdtemp(join(tmpdir(), 'ci-report-audit-'));
        try {
          const archive = join(directory, 'report.zip');
          await writeFile(archive, Buffer.from(match[1], 'base64'));
          await walk(archive);
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
    }
    if (path.endsWith('.zip')) {
      const entries = execFileSync('unzip',['-Z1',path],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n');
      for (const entry of entries) {
        if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || /[\x00-\x1f]/.test(entry)) throw new Error('Unsafe trace archive path');
        if (entry.endsWith('/')) continue;
        const content = execFileSync('unzip',['-p',path,entry],{maxBuffer:10*1024*1024});
        inspect(entry,content);
      }
    }
  }
  for (const path of paths) await walk(resolve(path));
  return { files, bytes };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  auditArtifacts(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode=1; });
}
