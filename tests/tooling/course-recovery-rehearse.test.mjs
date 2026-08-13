import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  builderRegister,
  runRecoveryRehearsal,
} from '../../tools/course-recovery/rehearse.mjs';

function command(executable, ...arguments_) {
  return { executable, arguments: arguments_ };
}

function register() {
  return {
    schemaVersion: 1,
    courseVersion: '1.0.0',
    cliVersion: '1.0.0',
    cli: {
      packageName: '@madeup-video/course',
      repository: 'https://github.com/madeupdev/madeup-video-course-cli',
    },
    project: {
      packageName: '@madeup-video/storefront',
      repository: 'https://github.com/madeupdev/advanced-monorepos-project',
      localArtifacts: [],
    },
    release: {
      repository: 'https://github.com/madeupdev/advanced-monorepos-project',
      tag: 'course-v1.0.0',
      maxAssetBytes: 1024,
    },
    states: [0, 1].map((index) => ({
      id: `S01-L0${index + 1}-start`,
      sourceCommit: String(index + 1).repeat(40),
      asset: `S01-L0${index + 1}-start.tar.gz`,
      sha256: 'PENDING',
      status: 'draft',
      verification: ['node learner-controlled.js'],
      trustedCI: {
        install: command('pnpm', 'install', '--frozen-lockfile'),
        setup: [],
        database: [command('pnpm', 'db:migrate')],
        verification: [command('pnpm', 'test:all')],
      },
      authoringNotes: 'private note',
    })),
    recipes: [],
    authoringNotes: 'private root note',
  };
}

test('creates a minimal temporary builder projection without private trusted metadata', () => {
  const projection = builderRegister(register());
  const source = JSON.stringify(projection);
  assert.equal(projection.states.length, 2);
  assert.doesNotMatch(source, /trustedCI|authoringNotes|private note/);
  assert.match(source, /learner-controlled/);
});

async function fixtureAdapters({ failBuild, failExtract, failCompare, failCommands } = {}) {
  const calls = {
    build: [],
    reachability: [],
    extract: [],
    verify: [],
    databases: [],
    commands: [],
  };
  const adapters = {
    validateRegister: async (value) => value,
    assertProjectCommitReachable: async (value) => calls.reachability.push(value),
    build: async ({ outputDirectory, register: value }) => {
      calls.build.push({ outputDirectory, register: value });
      if (failBuild) throw new Error('builder failed');
      await mkdir(outputDirectory);
      for (const state of value.states) {
        await writeFile(join(outputDirectory, state.asset), `archive ${state.id}`);
      }
      await writeFile(join(outputDirectory, 'manifest.json'), 'manifest\n');
      await writeFile(join(outputDirectory, 'SHA256SUMS'), 'sums\n');
    },
    audit: async (_directory, value) => ({
      names: [...value.states.map(({ asset }) => asset), 'manifest.json', 'SHA256SUMS'],
      assets: value.states.map((state) => ({ ...state, size: 1, sha256: 'a'.repeat(64) })),
    }),
    compare: async () => {
      if (failCompare) throw new Error('nondeterministic second build');
    },
    deriveLimits: async () => ({ maxEntries: 1, maxEntryBytes: 1, maxTotalBytes: 1 }),
    extract: async (value) => {
      calls.extract.push(value);
      await mkdir(value.destination);
      await writeFile(join(value.destination, 'partial'), 'x');
      if (failExtract) throw new Error('extract failed');
    },
    verifyTree: async (value) => calls.verify.push(value),
    withDatabases: async (value) => {
      calls.databases.push(value);
      await value.action({
        environment: {
          DATABASE_URL: `postgresql://redacted/state_${value.index}`,
          TEST_DATABASE_URL: `postgresql://redacted/state_${value.index}_test`,
        },
        sensitiveValues: ['postgresql://redacted'],
      });
    },
    runStateCommands: async (state, value) => {
      calls.commands.push({ state, value });
      if (failCommands) throw new Error('trusted setup failed');
    },
  };
  return { adapters, calls };
}

test('cleans the rehearsal root when writing the temporary builder register fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'course-rehearse-write-failure-'));
  const fixture = await fixtureAdapters();
  fixture.adapters.writeBuilderRegister = async () => {
    throw new Error('register write failed');
  };
  await assert.rejects(
    runRecoveryRehearsal({
      register: register(),
      projectDirectory: '/fixed/project',
      outputDirectory: join(parent, 'artifact'),
      temporaryParent: parent,
      baseEnvironment: { PATH: '/trusted/bin' },
      adapters: fixture.adapters,
    }),
    /register write failed/,
  );
  assert.deepEqual(await readdir(parent), []);
});

test('builds twice, verifies every state in isolation, and copies only the bundle allowlist', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'course-rehearse-test-'));
  const outputDirectory = join(parent, 'artifact');
  const fixture = await fixtureAdapters();
  const result = await runRecoveryRehearsal({
    register: register(),
    projectDirectory: '/fixed/project',
    outputDirectory,
    temporaryParent: parent,
    baseEnvironment: { PATH: '/trusted/bin' },
    adapters: fixture.adapters,
  });
  assert.equal(fixture.calls.build.length, 2);
  assert.equal(fixture.calls.reachability.length, 2);
  assert.equal(fixture.calls.extract.length, 2);
  assert.equal(fixture.calls.verify.length, 2);
  assert.equal(fixture.calls.databases.length, 2);
  assert.equal(fixture.calls.commands.length, 2);
  assert.notEqual(
    fixture.calls.extract[0].destination,
    fixture.calls.extract[1].destination,
  );
  assert.notEqual(
    fixture.calls.commands[0].value.environment.HOME,
    fixture.calls.commands[1].value.environment.HOME,
  );
  assert.notEqual(
    fixture.calls.commands[0].value.environment.PLAYWRIGHT_BROWSERS_PATH,
    fixture.calls.commands[1].value.environment.PLAYWRIGHT_BROWSERS_PATH,
  );
  for (const call of fixture.calls.commands) {
    assert.match(call.value.environment.PLAYWRIGHT_BROWSERS_PATH, /\/cache\/ms-playwright$/);
  }
  assert.doesNotMatch(
    JSON.stringify(fixture.calls.commands.map(({ state }) => state.trustedCI)),
    /learner-controlled/,
  );
  assert.deepEqual((await readdir(outputDirectory)).sort(), [
    'S01-L01-start.tar.gz',
    'S01-L02-start.tar.gz',
    'SHA256SUMS',
    'manifest.json',
  ].sort());
  assert.equal(result.assets.length, 2);
  await assert.rejects(stat(fixture.calls.build[0].outputDirectory), { code: 'ENOENT' });
});

for (const [label, options, pattern] of [
  ['builder failure', { failBuild: true }, /builder failed/],
  ['nondeterministic build', { failCompare: true }, /nondeterministic/],
  ['extraction failure', { failExtract: true }, /extract failed/],
  ['trusted setup failure', { failCommands: true }, /trusted setup failed/],
]) {
  test(`cleans all temporary and partial state directories after ${label}`, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'course-rehearse-failure-'));
    const outputDirectory = join(parent, 'artifact');
    const fixture = await fixtureAdapters(options);
    await assert.rejects(
      runRecoveryRehearsal({
        register: register(),
        projectDirectory: '/fixed/project',
        outputDirectory,
        temporaryParent: parent,
        baseEnvironment: { PATH: '/trusted/bin' },
        adapters: fixture.adapters,
      }),
      pattern,
    );
    if (fixture.calls.build[0]) {
      await assert.rejects(stat(fixture.calls.build[0].outputDirectory), { code: 'ENOENT' });
    }
    await assert.rejects(stat(outputDirectory), { code: 'ENOENT' });
  });
}

test('validates the complete register before building or reading operational state fields', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'course-rehearse-invalid-'));
  const fixture = await fixtureAdapters();
  fixture.adapters.validateRegister = async () => {
    throw new Error('private register malformed');
  };
  await assert.rejects(
    runRecoveryRehearsal({
      register: { states: [{ asset: '../unsafe' }] },
      projectDirectory: '/fixed/project',
      outputDirectory: join(parent, 'artifact'),
      temporaryParent: parent,
      baseEnvironment: {},
      adapters: fixture.adapters,
    }),
    /private register malformed/,
  );
  assert.equal(fixture.calls.build.length, 0);
});
