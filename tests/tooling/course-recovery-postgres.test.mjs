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
        const failure = Array.isArray(step.query) ? step.query.shift() : step.query;
        if (failure) throw failure;
        return { rows: [] };
      },
      async end() { call.ended = true; if (step.end) throw step.end; },
    };
  };
  return { calls, createClient };
}

function errorTree(error) {
  const nodes = [];
  const seen = new Set();
  const visit = (value) => {
    if (!(value instanceof Error) || seen.has(value)) return;
    seen.add(value);
    nodes.push(value);
    if (value instanceof AggregateError) value.errors.forEach(visit);
    visit(value.cause);
  };
  visit(error);
  return nodes;
}

function errorTreeMessages(error) {
  return errorTree(error).map(({ message }) => message);
}

function assertErrorTreeRedacted(error, values) {
  const messages = errorTreeMessages(error).join('\n');
  for (const value of values) assert.doesNotMatch(messages, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(errorTree(error).some(({ cause }) => cause !== undefined), false);
}

test('collects messages from nested aggregate errors and causes', () => {
  const error = new AggregateError([
    new Error('first'),
    new AggregateError([new Error('second')], 'nested', { cause: new Error('cause') }),
  ], 'outer');
  assert.deepEqual(errorTreeMessages(error), ['outer', 'first', 'nested', 'second', 'cause']);
});

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

test('uses fresh readiness clients and sleeps exactly once before a later success', async () => {
  const fixture = clients([{ connect: new Error('first private password') }, {}]);
  const sleeps = [];
  await assertPostgresHealthy({ environment, createClient: fixture.createClient, sleep: async (ms) => sleeps.push(ms), attempts: 3 });
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls.every(({ ended }) => ended), true);
  assert.deepEqual(sleeps, [250]);
});

test('keeps every sanitized final readiness query and close failure', async () => {
  const fixture = clients([{ query: new Error('query private password'), end: new Error('close private%20password') }]);
  await assert.rejects(
    assertPostgresHealthy({ environment, createClient: fixture.createClient, sleep: async () => {}, attempts: 1 }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.length, 2);
      assert.match(error.message, /PostgreSQL health check failed/);
      assert.deepEqual(errorTreeMessages(error), [
        'PostgreSQL health check failed: PostgreSQL readiness client cleanup failed',
        'query [REDACTED]',
        'close [REDACTED]',
      ]);
      assertErrorTreeRedacted(error, ['private password', 'private%20password']);
      return true;
    },
  );
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

test('keeps create query and close failures as separate sanitized errors', async () => {
  const fixture = clients([{}, { query: new Error('create private password'), end: new Error('create close private%20password') }]);
  await assert.rejects(
    withIsolatedDatabases({ stateId: 'S03-L03-start', index: 3, environment, createClient: fixture.createClient, sleep: async () => {}, action: async () => assert.fail('must not act') }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.length, 2);
      assert.deepEqual(errorTreeMessages(error), [
        'PostgreSQL database creation failed',
        'create [REDACTED]',
        'create close [REDACTED]',
      ]);
      assertErrorTreeRedacted(error, ['private password', 'private%20password']);
      return true;
    },
  );
});

test('preserves a sanitized action failure when cleanup succeeds', async () => {
  const fixture = clients();
  await assert.rejects(
    withIsolatedDatabases({ stateId: 'S03-L04-start', index: 3, environment, createClient: fixture.createClient, sleep: async () => {}, action: async () => { throw new Error('verification private password'); } }),
    (error) => {
      assert.equal(error instanceof AggregateError, false);
      assert.match(error.message, /verification \[REDACTED\]/);
      assert.deepEqual(errorTreeMessages(error), ['verification [REDACTED]']);
      assertErrorTreeRedacted(error, ['private password', 'private%20password']);
      return true;
    },
  );
});

test('rejects with cleanup failures after a successful action', async () => {
  const fixture = clients([{}, {}, {}, { query: [new Error('cleanup private password'), undefined] }, {}]);
  await assert.rejects(
    withIsolatedDatabases({ stateId: 'S03-L05-start', index: 3, environment, createClient: fixture.createClient, sleep: async () => {}, action: async () => 'complete' }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.length, 1);
      assert.match(error.message, /PostgreSQL state cleanup failed/);
      assert.deepEqual(errorTreeMessages(error), [
        'PostgreSQL state cleanup failed',
        'cleanup [REDACTED]',
      ]);
      assertErrorTreeRedacted(error, ['private password', 'private%20password']);
      return true;
    },
  );
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
      assertErrorTreeRedacted(error, [
        'private password', 'private%20password', rawUrl, testUrl,
      ]);
      return true;
    },
  );
  assert.equal(fixture.calls.length, 5);
  assert.equal(fixture.calls.at(-1).ended, true);
});
