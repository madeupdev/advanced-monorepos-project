import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar-stream';

const exec = promisify(execFile);
const FILE_MODES = new Set([0o644, 0o755]);
const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxArchiveBytes: 256 * 1024 * 1024,
});

function portablePath(path) {
  if (path.length === 0) throw new Error('Archive entry has an empty unsafe path');
  if (path !== path.normalize('NFC')) throw new Error(`Archive path is not NFC normalized: ${path}`);
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new Error(`Archive path contains controls: ${path}`);
  if (isAbsolute(path) || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`Archive path is absolute: ${path}`);
  }
  if (path.includes('\\')) throw new Error(`Archive path uses an unsafe separator: ${path}`);
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Archive path contains unsafe traversal or empty segments: ${path}`);
  }
  if (segments.some((segment) => /[<>:"|?*]/.test(segment))) {
    throw new Error(`Archive path is not portable: ${path}`);
  }
  if (segments.some((segment) => segment.endsWith(' ') || segment.endsWith('.'))) {
    throw new Error(`Archive path has a non-portable trailing dot or space: ${path}`);
  }
  if (
    segments.some((segment) =>
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment))
  ) {
    throw new Error(`Archive path contains a Windows-reserved basename: ${path}`);
  }
  return path;
}

function key(path) {
  return path.normalize('NFC').toLowerCase();
}

function validatedLimits(value) {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...(value ?? {}) };
  for (const field of [
    'maxEntries',
    'maxEntryBytes',
    'maxTotalBytes',
    'maxArchiveBytes',
  ]) {
    if (!Number.isSafeInteger(limits[field]) || limits[field] < 0) {
      throw new Error(`Archive ${field} must be a non-negative safe integer`);
    }
  }
  return limits;
}

function decompressedByteLimiter(maximum) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maximum) {
        callback(new Error(
          `Decompressed archive size exceeds limit ${String(maximum)}`,
        ));
        return;
      }
      callback(null, chunk);
    },
  });
}

async function readTarEntries(archivePath, requestedLimits) {
  const limits = validatedLimits(requestedLimits);
  const parser = extract();
  // Keep a permanent listener because a destroyed tar entry can propagate the
  // same failure after pipeline() has removed its temporary listeners.
  parser.on('error', () => undefined);
  const entries = [];
  let entryCount = 0;
  let declaredTotal = 0;
  let observedTotal = 0;
  let archiveFailure;
  const abort = (error) => {
    archiveFailure ??= error;
    // Do not propagate the application error through every stream in the
    // pipeline: some stream implementations re-emit it after pipeline cleanup.
    parser.destroy();
  };
  parser.on('entry', (header, stream, next) => {
    entryCount += 1;
    if (entryCount > limits.maxEntries) {
      abort(new Error(
        `Archive entry count exceeds limit ${String(limits.maxEntries)}`,
      ));
      return;
    }
    if (!Number.isSafeInteger(header.size) || header.size < 0) {
      abort(new Error(`Archive entry has an invalid size: ${header.name}`));
      return;
    }
    if (header.size > limits.maxEntryBytes) {
      abort(new Error(
        `Archive entry size exceeds limit ${String(limits.maxEntryBytes)}: ${header.name}`,
      ));
      return;
    }
    declaredTotal += header.size;
    if (declaredTotal > limits.maxTotalBytes) {
      abort(new Error(
        `Archive total size exceeds limit ${String(limits.maxTotalBytes)}`,
      ));
      return;
    }
    const chunks = [];
    let entryBytes = 0;
    stream.on('data', (chunk) => {
      if (parser.destroyed) return;
      entryBytes += chunk.length;
      observedTotal += chunk.length;
      if (entryBytes > limits.maxEntryBytes) {
        abort(new Error(
          `Archive entry size exceeds limit ${String(limits.maxEntryBytes)}: ${header.name}`,
        ));
        return;
      }
      if (observedTotal > limits.maxTotalBytes) {
        abort(new Error(
          `Archive total size exceeds limit ${String(limits.maxTotalBytes)}`,
        ));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => {
      if (!parser.destroyed) abort(error);
    });
    stream.once('end', () => {
      if (parser.destroyed) return;
      entries.push({ header, contents: Buffer.concat(chunks) });
      next();
    });
  });
  try {
    await pipeline(
      createReadStream(archivePath),
      createGunzip(),
      decompressedByteLimiter(limits.maxArchiveBytes),
      parser,
    );
  } catch (error) {
    throw archiveFailure ?? error;
  }
  if (archiveFailure) throw archiveFailure;
  return entries;
}

function validatedEntries(entries) {
  const seen = new Map();
  return entries.map(({ header, contents }) => {
    if (!['file', 'directory'].includes(header.type)) {
      throw new Error(`Archive links and special entries are unsupported: ${header.name}`);
    }
    const rawName = header.type === 'directory'
      ? header.name.replace(/\/+$/u, '')
      : header.name;
    const path = portablePath(rawName);
    const pathKey = key(path);
    if (seen.has(pathKey)) {
      throw new Error(`Duplicate or portable-colliding archive path: ${path}`);
    }
    seen.set(pathKey, path);
    const mode = (header.mode ?? 0) & 0o777;
    if (header.type === 'directory') {
      if (mode !== 0o755 || contents.length !== 0) {
        throw new Error(`Unsupported archive directory mode or contents: ${path}`);
      }
    } else {
      if (!FILE_MODES.has(mode)) throw new Error(`Unsupported archive file mode: ${path}`);
      if (header.size !== contents.length) throw new Error(`Archive entry size mismatch: ${path}`);
    }
    return { path, type: header.type, mode, contents };
  });
}

export async function inspectAndExtractArchive({ archivePath, destination, limits }) {
  const entries = validatedEntries(await readTarEntries(archivePath, limits));
  await mkdir(destination, { mode: 0o700 });
  try {
    for (const entry of entries.filter(({ type }) => type === 'directory')) {
      const target = resolve(destination, entry.path);
      if (relative(destination, target).startsWith(`..${sep}`)) {
        throw new Error(`Archive entry escaped extraction root: ${entry.path}`);
      }
      await mkdir(target, { recursive: true, mode: entry.mode });
      await chmod(target, entry.mode);
    }
    for (const entry of entries.filter(({ type }) => type === 'file')) {
      const target = resolve(destination, entry.path);
      const fromRoot = relative(destination, target);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error(`Archive entry escaped extraction root: ${entry.path}`);
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, entry.contents, { flag: 'wx', mode: entry.mode });
      await chmod(target, entry.mode);
    }
    return { entries };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function git(repository, args, encoding = 'buffer') {
  try {
    const result = await exec('git', args, {
      cwd: repository,
      encoding,
      maxBuffer: 128 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    throw new Error(`Git tree inspection failed: ${String(error.stderr ?? error.message).trim()}`);
  }
}

async function expectedGitFiles(repository, commit) {
  const output = await git(repository, ['ls-tree', '-rz', '--full-tree', commit]);
  const records = Buffer.from(output).subarray(0, -1).toString('binary').split('\0').filter(Boolean);
  const files = [];
  for (const raw of records) {
    const record = Buffer.from(raw, 'binary');
    const tab = record.indexOf(0x09);
    if (tab < 0) throw new Error('Git returned a malformed tree entry');
    const [mode, type, object] = record.subarray(0, tab).toString('ascii').split(' ');
    const path = new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(tab + 1));
    portablePath(path);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error(`Unsupported Git tree entry: ${path}`);
    }
    const contents = Buffer.from(await git(repository, ['cat-file', 'blob', object]));
    files.push({ path, mode: mode === '100755' ? 0o755 : 0o644, contents });
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

export async function deriveArchiveLimits({ repository, commit }) {
  const files = await expectedGitFiles(repository, commit);
  const directories = new Set();
  for (const file of files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  const maxArchiveBytes =
    (files.length + directories.size) * 512 +
    files.reduce(
      (total, file) => total + Math.ceil(file.contents.length / 512) * 512,
      0,
    ) +
    1024;
  return {
    maxEntries: files.length + directories.size,
    maxEntryBytes: files.reduce(
      (maximum, file) => Math.max(maximum, file.contents.length),
      0,
    ),
    maxTotalBytes: files.reduce((total, file) => total + file.contents.length, 0),
    maxArchiveBytes,
  };
}

async function extractedFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    const path = relative(root, target).split(sep).join('/');
    const information = await lstat(target);
    if (information.isSymbolicLink() || (!information.isFile() && !information.isDirectory())) {
      throw new Error(`Extracted tree contains a link or special entry: ${path}`);
    }
    if (information.isDirectory()) files.push(...await extractedFiles(root, target));
    else files.push({
      path,
      mode: information.mode & 0o777,
      contents: await readFile(target),
    });
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

export async function verifyExtractedTree({ repository, commit, destination }) {
  const [expected, actual] = await Promise.all([
    expectedGitFiles(repository, commit),
    extractedFiles(destination),
  ]);
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  for (const path of expectedByPath.keys()) {
    if (!actualByPath.has(path)) throw new Error(`Missing extracted file: ${path}`);
  }
  for (const path of actualByPath.keys()) {
    if (!expectedByPath.has(path)) throw new Error(`Extra extracted file: ${path}`);
  }
  for (const [path, expectedFile] of expectedByPath) {
    const actualFile = actualByPath.get(path);
    if (actualFile.mode !== expectedFile.mode) throw new Error(`Mode mismatch for ${path}`);
    if (!actualFile.contents.equals(expectedFile.contents)) {
      const expectedDigest = createHash('sha256').update(expectedFile.contents).digest('hex');
      const actualDigest = createHash('sha256').update(actualFile.contents).digest('hex');
      throw new Error(`Byte SHA-256 mismatch for ${path}: ${expectedDigest} != ${actualDigest}`);
    }
  }
  return { files: actual.map(({ path, mode }) => ({ path, mode })) };
}
