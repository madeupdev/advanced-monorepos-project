import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;

function collisionKey(value) {
  return value.normalize('NFC').toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function expectedBundleNames(register) {
  const ids = new Set();
  const names = new Set();
  const expected = [];
  for (const state of register.states) {
    const idKey = collisionKey(state.id);
    const assetKey = collisionKey(state.asset);
    if (ids.has(idKey)) throw new Error(`Duplicate or colliding state ID: ${state.id}`);
    if (names.has(assetKey)) throw new Error(`Duplicate or colliding asset: ${state.asset}`);
    ids.add(idKey);
    names.add(assetKey);
    expected.push(state.asset);
  }
  for (const name of ['manifest.json', 'SHA256SUMS']) {
    const key = collisionKey(name);
    if (names.has(key)) throw new Error(`Duplicate or colliding bundle name: ${name}`);
    names.add(key);
    expected.push(name);
  }
  return expected;
}

async function exactBundleFiles(directory, expectedNames) {
  const entries = await readdir(directory, { withFileTypes: true });
  const actual = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Unexpected non-file bundle entry: ${entry.name}`);
    }
    const key = collisionKey(entry.name);
    if (actual.has(key)) throw new Error(`Duplicate portable bundle entry: ${entry.name}`);
    actual.set(key, entry.name);
  }
  const expected = new Map(expectedNames.map((name) => [collisionKey(name), name]));
  for (const [key, name] of expected) {
    if (!actual.has(key)) throw new Error(`Missing expected bundle file: ${name}`);
    if (actual.get(key) !== name) throw new Error(`Bundle filename collision: ${actual.get(key)}`);
  }
  for (const [key, name] of actual) {
    if (!expected.has(key)) throw new Error(`Unexpected bundle file: ${name}`);
  }
}

function parseManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error('manifest.json must contain valid JSON');
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error('manifest.json has a malformed recovery asset list');
  }
  return manifest;
}

export async function auditBundle(directory, register) {
  const expectedNames = expectedBundleNames(register);
  await exactBundleFiles(directory, expectedNames);
  const manifest = parseManifest(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.courseVersion !== register.courseVersion) {
    throw new Error('manifest.json release identity does not match the register');
  }
  if (
    manifest.release?.repository !== register.release.repository ||
    manifest.release?.tag !== register.release.tag
  ) {
    throw new Error('manifest.json release identity does not match the register');
  }
  if (manifest.assets.length !== register.states.length) {
    throw new Error('manifest.json asset count does not match the register');
  }

  const sumsSource = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  const sumLines = sumsSource === '' ? [] : sumsSource.split('\n').filter(Boolean);
  if (sumLines.length !== register.states.length) {
    throw new Error('SHA256SUMS line count does not match the register');
  }

  const assets = [];
  for (const [index, state] of register.states.entries()) {
    const metadata = manifest.assets[index];
    if (
      metadata?.id !== state.id ||
      metadata?.sourceCommit !== state.sourceCommit ||
      metadata?.asset !== state.asset
    ) {
      throw new Error(`manifest.json asset identity mismatch for ${state.id}`);
    }
    const bytes = await readFile(join(directory, state.asset));
    if (bytes.length > register.release.maxAssetBytes) {
      throw new Error(`${state.asset} exceeds release.maxAssetBytes`);
    }
    if (!Number.isSafeInteger(metadata.size) || metadata.size !== bytes.length) {
      throw new Error(`Archive size mismatch for ${state.asset}`);
    }
    const digest = sha256(bytes);
    if (!SHA256.test(metadata.sha256) || metadata.sha256 !== digest) {
      throw new Error(`Archive SHA-256 mismatch for ${state.asset}`);
    }
    if (state.sha256 !== 'PENDING' && state.sha256 !== digest) {
      throw new Error(`Archive SHA-256 differs from the authoritative register for ${state.asset}`);
    }
    if (sumLines[index] !== `${digest}  ${state.asset}`) {
      throw new Error(`SHA256SUMS mismatch for ${state.asset}`);
    }
    assets.push({ ...state, size: bytes.length, sha256: digest });
  }
  return { assets, names: expectedNames };
}

export async function compareBundleDirectories(first, second, names) {
  await exactBundleFiles(first, names);
  await exactBundleFiles(second, names);
  for (const name of names) {
    const [left, right] = await Promise.all([
      readFile(join(first, name)),
      readFile(join(second, name)),
    ]);
    if (!left.equals(right)) throw new Error(`Build outputs are not byte-identical: ${name}`);
  }
}
