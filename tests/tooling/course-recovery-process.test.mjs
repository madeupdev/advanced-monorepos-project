import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  createControlledEnvironment,
  runTrustedCommand,
  runTrustedStateCommands,
} from '../../tools/course-recovery/process.mjs';

function spawnFixture({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const calls = [];
  const spawn = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit('close', exitCode, null);
    });
    return child;
  };
  return { calls, spawn };
}

test('creates a minimal state-specific environment without inherited secrets', () => {
  assert.deepEqual(
    createControlledEnvironment({
      inherited: {
        PATH: '/trusted/bin',
        HOME: '/inherited/home',
        AUTHORING_READ_TOKEN: 'do-not-copy',
        DATABASE_URL: 'do-not-copy',
        RANDOM_FLAG: 'do-not-copy',
      },
      home: '/fixed/state/home',
      cache: '/fixed/state/cache',
      databaseUrl: 'postgresql://course:secret@localhost/state',
      testDatabaseUrl: 'postgresql://course:secret@localhost/state_test',
    }),
    {
      PATH: '/trusted/bin',
      HOME: '/fixed/state/home',
      XDG_CACHE_HOME: '/fixed/state/cache',
      NX_CACHE_DIRECTORY: '/fixed/state/cache/nx',
      PLAYWRIGHT_BROWSERS_PATH: '/fixed/state/cache/ms-playwright',
      CI: 'true',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      DATABASE_URL: 'postgresql://course:secret@localhost/state',
      TEST_DATABASE_URL: 'postgresql://course:secret@localhost/state_test',
    },
  );
});

test('spawns a structured command with shell disabled and a fixed cwd', async () => {
  const fixture = spawnFixture();
  await runTrustedCommand(
    { executable: 'pnpm', arguments: ['install', '--frozen-lockfile'] },
    {
      cwd: '/fixed/extracted-state',
      environment: { PATH: '/trusted/bin' },
      spawn: fixture.spawn,
      sensitiveValues: [],
    },
  );
  assert.deepEqual(fixture.calls, [{
    executable: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    options: {
      cwd: '/fixed/extracted-state',
      env: { PATH: '/trusted/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  }]);
});

test('redacts sensitive diagnostics and fails on a nonzero exit', async () => {
  const fixture = spawnFixture({
    exitCode: 7,
    stderr: 'database postgresql://user:private@localhost/state failed',
  });
  await assert.rejects(
    runTrustedCommand(
      { executable: 'pnpm', arguments: ['test:all'] },
      {
        cwd: '/fixed/state',
        environment: {},
        spawn: fixture.spawn,
        sensitiveValues: ['postgresql://user:private@localhost/state', 'private'],
      },
    ),
    (error) => {
      assert.match(error.message, /exit 7/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, /private/);
      return true;
    },
  );
});

test('bounds retained diagnostics', async () => {
  const fixture = spawnFixture({ exitCode: 1, stderr: 'x'.repeat(100_000) });
  await assert.rejects(
    runTrustedCommand(
      { executable: 'pnpm', arguments: ['test'] },
      {
        cwd: '/fixed/state',
        environment: {},
        spawn: fixture.spawn,
        sensitiveValues: [],
        maxDiagnosticBytes: 256,
      },
    ),
    (error) => {
      assert.ok(error.message.length < 1_000);
      assert.match(error.message, /truncated/);
      return true;
    },
  );
});

test('runs only private trusted-CI phases and never learner verification strings', async () => {
  const fixture = spawnFixture();
  await runTrustedStateCommands(
    {
      verification: ['node learner-controlled.js'],
      trustedCI: {
        install: { executable: 'pnpm', arguments: ['install', '--frozen-lockfile'] },
        setup: [{ executable: 'pnpm', arguments: ['db:generate'] }],
        database: [{ executable: 'pnpm', arguments: ['exec', 'prisma', 'migrate', 'deploy'] }],
        verification: [{ executable: 'pnpm', arguments: ['test:all'] }],
      },
    },
    {
      cwd: '/fixed/state',
      environment: {},
      spawn: fixture.spawn,
      sensitiveValues: [],
    },
  );
  assert.deepEqual(
    fixture.calls.map(({ executable, args }) => [executable, ...args]),
    [
      ['pnpm', 'install', '--frozen-lockfile'],
      ['pnpm', 'db:generate'],
      ['pnpm', 'exec', 'prisma', 'migrate', 'deploy'],
      ['pnpm', 'test:all'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(fixture.calls), /learner-controlled/);
});

for (const [phase, command] of [
  ['setup', { executable: 'pnpm', arguments: ['db:generate'] }],
  ['database', { executable: 'pnpm', arguments: ['db:migrate'] }],
  ['verification', { executable: 'pnpm', arguments: ['test:all'] }],
]) {
  test(`fails when a trusted ${phase} command fails`, async () => {
    let call = 0;
    const spawn = (...args) => {
      call += 1;
      return spawnFixture({ exitCode: call === 2 ? 9 : 0 }).spawn(...args);
    };
    await assert.rejects(
      runTrustedStateCommands(
        {
          verification: ['never execute me'],
          trustedCI: {
            install: { executable: 'pnpm', arguments: ['install', '--frozen-lockfile'] },
            setup: phase === 'setup' ? [command] : [],
            database: phase === 'database' ? [command] : [],
            verification: phase === 'verification' ? [command] : [
              { executable: 'pnpm', arguments: ['ok'] },
            ],
          },
        },
        { cwd: '/fixed/state', environment: {}, spawn, sensitiveValues: [] },
      ),
      /exit 9/,
    );
  });
}
