import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertPostgresHealthy, databaseNames, withIsolatedDatabases } from '../../tools/course-recovery/postgres.mjs';

const environment = { PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'course_recovery', PGPASSWORD: 'private password' };

function clients(steps = []) {
  const calls = [];
  const queue = [...steps];
  const createClient = (options) => {
    const step = queue.shift() ?? {};
    const call = { options, queries: [], ended: false };
    calls.push(call);
    return {
      async connect() { if (step.connect) throw step.connect; },
      async query(text, values) {
        call.queries.push({ text, values });
        const failure = step.query?.shift?.() ?? step.query;
        if (failure) throw failure;
        return { rows: [] };
      },
      async end() { call.ended = true; if (step.end) throw step.end; },
    };
  };
  return { calls, createClient };
}

test('derives distinct portable names without exposing the state ID', () => {
  const first = databaseNames('S01-L01-start', 0);
  assert.match(first.primary, /^course_recovery_[0-9]{3}_[a-f0-9]{12}$/);
  assert.equal(first.test, `${first.primary}_test`);
  assert.notDeepEqual(first, databaseNames('S01-L01-start', 1));
  assert.doesNotMatch(JSON.stringify(first), /S01|L01/i);
});

test('checks SELECT 1 through a fresh maintenance client without sleeping after success', async () => {
  const fixture = clients();
  const sleeps = [];
  await assertPostgresHealthy({ environment, createClient: fixture.createClient, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].options.database, 'postgres');
  assert.equal(fixture.calls[0].options.connectionTimeoutMillis > 0, true);
  assert.deepEqual(fixture.calls[0].queries, [{ text: 'SELECT 1', values: undefined }]);
  assert.deepEqual(sleeps, []);
});

test('retries readiness only before a later attempt and stops after the final failure', async () => {
  const fixture = clients([{ connect: new Error('not ready') }, { query: new Error('still not ready') }, { connect: new Error('last attempt') }]);
  const sleeps = [];
  await assert.rejects(
    assertPostgresHealthy({ environment, createClient: fixture.createClient, sleep: async (ms) => sleeps.push(ms), attempts: 3 }),
    /PostgreSQL health check failed/,
  );
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(sleeps, [250, 250]);
});

test('creates and force-cleans names through safe SQL, never host PostgreSQL commands', async () => {
  const fixture = clients();
  let stateEnvironment;
  await withIsolatedDatabases({
    stateId: 'S02-L01-start', index: 2, environment, createClient: fixture.createClient,
    sleep: async () => assert.fail('readiness should not sleep'),
    action: async ({ environment: received }) => { stateEnvironment = received; },
  });
  const names = databaseNames('S02-L01-start', 2);
  const queries = fixture.calls.flatMap(({ queries: value }) => value);
  assert.match(stateEnvironment.DATABASE_URL, /private%20password/);
  assert.deepEqual(queries.map(({ text }) => text), [
    'SELECT 1', `CREATE DATABASE "${names.primary}"`, `CREATE DATABASE "${names.test}"`,
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', `DROP DATABASE IF EXISTS "${names.test}"`,
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', `DROP DATABASE IF EXISTS "${names.primary}"`,
  ]);
  assert.deepEqual(queries.filter(({ text }) => text.startsWith('SELECT pg_terminate')).map(({ values }) => values), [[names.test], [names.primary]]);
  assert.doesNotMatch(JSON.stringify(fixture), /pg_isready|createdb|dropdb/);
});

test('cleans the first database after a partial second create failure', async () => {
  const fixture = clients([{}, {}, { query: new Error('second create failed') }, {}]);
  await assert.rejects(
    withIsolatedDatabases({ stateId: 'S03-L01-start', index: 3, environment, createClient: fixture.createClient, sleep: async () => {}, action: async () => assert.fail('must not act') }),
    /second create failed/,
  );
  const names = databaseNames('S03-L01-start', 3);
  assert.deepEqual(fixture.calls.flatMap(({ queries }) => queries).map(({ text }) => text), [
    'SELECT 1', `CREATE DATABASE "${names.primary}"`, `CREATE DATABASE "${names.test}"`,
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', `DROP DATABASE IF EXISTS "${names.primary}"`,
  ]);
});

test('records database ownership before a create-client close failure so cleanup cannot leak it', async () => {
  const fixture = clients([{}, { end: new Error('close after create') }, {}]);
  await assert.rejects(
    withIsolatedDatabases({ stateId: 'S03-L02-start', index: 3, environment, createClient: fixture.createClient, sleep: async () => {}, action: async () => assert.fail('must not act') }),
    /close after create/,
  );
  const name = databaseNames('S03-L02-start', 3).primary;
  assert.deepEqual(fixture.calls.at(-1).queries.map(({ text }) => text), [
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    `DROP DATABASE IF EXISTS "${name}"`,
  ]);
  assert.equal(fixture.calls.every(({ ended }) => ended), true);
});

test('continues reverse cleanup after action and cleanup failures, aggregating redacted errors', async () => {
  const names = databaseNames('S04-L01-start', 4);
  const rawUrl = `postgresql://course_recovery:private%20password@127.0.0.1:5432/${names.primary}`;
  const testUrl = `${rawUrl}_test`;
  const fixture = clients([
    {}, {}, {},
    { query: [new Error(`terminate ${rawUrl}`), new Error('drop test private password')], end: new Error('close test private%20password') },
    { query: [new Error('terminate primary private password'), new Error('drop primary private%20password')], end: new Error('close primary private password') },
  ]);
  await assert.rejects(
    withIsolatedDatabases({
      stateId: 'S04-L01-start', index: 4, environment, createClient: fixture.createClient, sleep: async () => {},
      action: async () => { throw new Error(`verification ${rawUrl} ${testUrl} private password`); },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.length, 7);
      assert.doesNotMatch(`${error.message}\n${error.errors.map((item) => item.message).join('\n')}`, /private password|private%20password|postgresql:\/\//);
      return true;
    },
  );
  assert.equal(fixture.calls.length, 5);
  assert.equal(fixture.calls.at(-1).ended, true);
});
