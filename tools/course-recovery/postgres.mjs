import { createHash } from 'node:crypto';

import { Client } from 'pg';

import { redactSensitiveValues } from './process.mjs';

const CONNECTION_TIMEOUT_MILLIS = 1_000;
const READINESS_ATTEMPTS = 3;
const READINESS_DELAY_MILLIS = 250;
const generatedName = /^course_recovery_\d{3}_[a-f0-9]{12}(?:_test)?$/;

export function databaseNames(stateId, index) {
  const digest = createHash('sha256').update(`${String(index)}\0${stateId}`, 'utf8').digest('hex').slice(0, 12);
  const primary = `course_recovery_${String(index).padStart(3, '0')}_${digest}`;
  return { primary, test: `${primary}_test` };
}

function connectionOptions(environment, database) {
  const password = environment.PGPASSWORD;
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('PostgreSQL password must be supplied through the protected runner environment');
  }
  return {
    host: environment.PGHOST ?? '127.0.0.1', port: Number(environment.PGPORT ?? '5432'),
    user: environment.PGUSER ?? 'postgres', password, database,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
  };
}

function databaseUrl(environment, database) {
  const options = connectionOptions(environment, database);
  return `postgresql://${encodeURIComponent(options.user)}:${encodeURIComponent(options.password)}@${options.host}:${options.port}/${database}`;
}

function secretValues(environment, urls = []) {
  const password = environment.PGPASSWORD ?? '';
  return [password, encodeURIComponent(password), ...urls].filter(Boolean);
}

function cleanError(error, secrets) {
  if (error instanceof AggregateError) {
    return new AggregateError(
      error.errors.map((child) => cleanError(child, secrets)),
      redactSensitiveValues(error.message, secrets),
    );
  }
  return new Error(redactSensitiveValues(error instanceof Error ? error.message : String(error), secrets));
}

function escapeIdentifier(name) {
  if (!generatedName.test(name)) throw new Error('Refusing to use an unsafe generated database name');
  return `"${name.replaceAll('"', '""')}"`;
}

async function execute({ environment, database = 'postgres', createClient, queries, secrets }) {
  const client = createClient(connectionOptions(environment, database));
  const failures = [];
  let completedQueries = 0;
  let connected = false;
  try {
    await client.connect();
    connected = true;
  } catch (error) {
    failures.push(cleanError(error, secrets));
  }
  if (connected) {
    for (const [text, values] of queries) {
      try {
        await client.query(text, values);
        completedQueries += 1;
      } catch (error) {
        failures.push(cleanError(error, secrets));
      }
    }
  }
  try {
    await client.end();
  } catch (error) {
    failures.push(cleanError(error, secrets));
  }
  return { failures, completedQueries };
}

function failureFrom(failures, message) {
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, message);
}

export async function assertPostgresHealthy({
  environment,
  createClient = (options) => new Client(options),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = READINESS_ATTEMPTS,
}) {
  const secrets = secretValues(environment);
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { failures } = await execute({ environment, createClient, queries: [['SELECT 1']], secrets });
    if (failures.length === 0) return;
    failure = failureFrom(failures, 'PostgreSQL readiness client cleanup failed');
    if (attempt + 1 < attempts) await sleep(READINESS_DELAY_MILLIS);
  }
  const message = `PostgreSQL health check failed: ${redactSensitiveValues(failure.message, secrets)}`;
  if (failure instanceof AggregateError) {
    throw new AggregateError(failure.errors, message);
  }
  throw new Error(message);
}

export async function withIsolatedDatabases({
  stateId,
  index,
  environment,
  createClient = (options) => new Client(options),
  sleep,
  action,
}) {
  await assertPostgresHealthy({ environment, createClient, sleep });
  const names = databaseNames(stateId, index);
  const urls = { primary: databaseUrl(environment, names.primary), test: databaseUrl(environment, names.test) };
  const secrets = secretValues(environment, [urls.primary, urls.test]);
  const created = [];
  let result;
  let primaryFailure;
  try {
    for (const name of [names.primary, names.test]) {
      const { failures, completedQueries } = await execute({ environment, createClient, secrets, queries: [[`CREATE DATABASE ${escapeIdentifier(name)}`]] });
      if (completedQueries === 1) created.push(name);
      if (failures.length > 0) throw failureFrom(failures, 'PostgreSQL database creation failed');
    }
    result = await action({ environment: { ...environment, DATABASE_URL: urls.primary, TEST_DATABASE_URL: urls.test }, sensitiveValues: secrets });
  } catch (error) {
    primaryFailure = cleanError(error, secrets);
  }
  const cleanupFailures = [];
  for (const name of [...created].reverse()) {
    const { failures } = await execute({
      environment, createClient, secrets,
      queries: [
        ['SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]],
        [`DROP DATABASE IF EXISTS ${escapeIdentifier(name)}`],
      ],
    });
    cleanupFailures.push(...failures);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      primaryFailure === undefined ? cleanupFailures : [primaryFailure, ...cleanupFailures],
      'PostgreSQL state cleanup failed',
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  return result;
}
