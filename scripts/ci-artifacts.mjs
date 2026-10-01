import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const patterns = [/postgres(?:ql)?:\/\/[^\s]+/i, /["']?(?:password|secret|token|api[_-]?key)["']?\s*[=:]\s*["']?[^\s"']+/i, /gh[pousr]_[a-z0-9]{20,}/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const limit = 64 * 1024 * 1024;
export async function auditArtifacts(paths) {
  let files = 0;
  let bytes = 0;
  const secrets = ['OPENROUTER_API_KEY','GH_TOKEN','GITHUB_TOKEN','PGPASSWORD'].map(key => process.env[key]).filter(value => value?.length >= 8);
  function inspect(name, data) {
    bytes += data.length;
    if (bytes > limit) throw new Error('Diagnostic audit size limit exceeded');
    const text = data.toString('utf8');
    // A bundled HTML reporter contains JavaScript defaults such as password=e.
    // Require a literal credential value there; inspect its encoded report ZIP too.
    const activePatterns = name.endsWith('.html')
      ? [patterns[0], patterns[2], patterns[3], /["']?(?:password|secret|token|api[_-]?key)["']?\s*[=:]\s*["'][^"']+["']/i]
      : patterns;
    if (/^\.env(?:\.|$)/.test(basename(name)) || activePatterns.some(pattern => pattern.test(text)) || secrets.some(value => text.includes(value))) {
      throw new Error(`Sensitive diagnostic content rejected: ${name}`);
    }
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
