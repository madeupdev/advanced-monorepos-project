import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertPostgresHealthy,
  databaseNames,
  withIsolatedDatabases,
} from '../../tools/course-recovery/postgres.mjs';

const baseEnvironment = {
  PATH: '/trusted/bin',
  PGHOST: '127.0.0.1',
  PGPORT: '5432',
  PGUSER: 'course_recovery',
  PGPASSWORD: 'private-password',
};

function recorder({ failAt } = {}) {
  const calls = [];
  const runCommand = async (command, options) => {
    calls.push({ command, options });
    if (calls.length === failAt) throw new Error('postgres command failed [REDACTED]');
  };
  return { calls, runCommand };
}

test('derives portable isolated database names without exposing the state ID', () => {
  const first = databaseNames('S01-L01-start', 0);
  const second = databaseNames('S01-L01-start', 1);
  assert.match(first.primary, /^course_recovery_[0-9]{3}_[a-f0-9]{12}$/);
  assert.equal(first.test, `${first.primary}_test`);
  assert.notDeepEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first), /S01|L01/i);
});

test('uses an explicit PostgreSQL health check without credentials in arguments', async () => {
  const fixture = recorder();
  await assertPostgresHealthy({
    cwd: '/fixed/runner',
    environment: baseEnvironment,
    runCommand: fixture.runCommand,
  });
  assert.deepEqual(fixture.calls.map(({ command }) => command), [{
    executable: 'pg_isready',
    arguments: ['--quiet', '--timeout=10'],
  }]);
  assert.doesNotMatch(JSON.stringify(fixture.calls[0].command), /private-password/);
});

test('fails closed when PostgreSQL health setup fails', async () => {
  const fixture = recorder({ failAt: 1 });
  await assert.rejects(
    assertPostgresHealthy({
      cwd: '/fixed/runner',
      environment: baseEnvironment,
      runCommand: fixture.runCommand,
    }),
    /PostgreSQL health check failed/,
  );
  assert.equal(fixture.calls.length, 1);
});

test('creates fresh databases, supplies state URLs, and always drops both', async () => {
  const fixture = recorder();
  let actionEnvironment;
  await withIsolatedDatabases({
    stateId: 'S01-L01-start',
    index: 0,
    cwd: '/fixed/runner',
    environment: baseEnvironment,
    runCommand: fixture.runCommand,
    action: async ({ environment }) => {
      actionEnvironment = environment;
    },
  });
  assert.match(actionEnvironment.DATABASE_URL, /course_recovery_000_[a-f0-9]{12}$/);
  assert.match(actionEnvironment.TEST_DATABASE_URL, /course_recovery_000_[a-f0-9]{12}_test$/);
  assert.doesNotMatch(JSON.stringify(fixture.calls.map(({ command }) => command)), /private-password/);
  assert.deepEqual(
    fixture.calls.map(({ command }) => [command.executable, ...command.arguments]),
    [
      ['pg_isready', '--quiet', '--timeout=10'],
      ['createdb', '--maintenance-db=postgres', actionEnvironment.DATABASE_URL.split('/').at(-1)],
      ['createdb', '--maintenance-db=postgres', actionEnvironment.TEST_DATABASE_URL.split('/').at(-1)],
      ['dropdb', '--if-exists', '--force', '--maintenance-db=postgres', actionEnvironment.TEST_DATABASE_URL.split('/').at(-1)],
      ['dropdb', '--if-exists', '--force', '--maintenance-db=postgres', actionEnvironment.DATABASE_URL.split('/').at(-1)],
    ],
  );
});

test('drops databases after the state action fails', async () => {
  const fixture = recorder();
  await assert.rejects(
    withIsolatedDatabases({
      stateId: 'S02-L01-start',
      index: 2,
      cwd: '/fixed/runner',
      environment: baseEnvironment,
      runCommand: fixture.runCommand,
      action: async () => {
        throw new Error('verification failed');
      },
    }),
    /verification failed/,
  );
  assert.deepEqual(
    fixture.calls.slice(-2).map(({ command }) => command.executable),
    ['dropdb', 'dropdb'],
  );
});

test('cleans the first database when creating the second fails', async () => {
  const fixture = recorder({ failAt: 3 });
  await assert.rejects(
    withIsolatedDatabases({
      stateId: 'S03-L01-start',
      index: 3,
      cwd: '/fixed/runner',
      environment: baseEnvironment,
      runCommand: fixture.runCommand,
      action: async () => assert.fail('action must not run'),
    }),
    /postgres command failed/,
  );
  assert.equal(fixture.calls.at(-1).command.executable, 'dropdb');
  assert.match(fixture.calls.at(-1).command.arguments.at(-1), /^course_recovery_003_/);
});
