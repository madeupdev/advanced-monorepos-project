import { createHash } from 'node:crypto';

import { runTrustedCommand } from './process.mjs';

export function databaseNames(stateId, index) {
  const digest = createHash('sha256')
    .update(`${String(index)}\0${stateId}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  const primary = `course_recovery_${String(index).padStart(3, '0')}_${digest}`;
  return { primary, test: `${primary}_test` };
}

function sensitiveValues(environment, ...additional) {
  return [
    environment.PGPASSWORD,
    ...additional,
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

export async function assertPostgresHealthy({
  cwd,
  environment,
  runCommand = runTrustedCommand,
}) {
  try {
    await runCommand(
      { executable: 'pg_isready', arguments: ['--quiet', '--timeout=10'] },
      {
        cwd,
        environment,
        sensitiveValues: sensitiveValues(environment),
      },
    );
  } catch (error) {
    throw new Error(`PostgreSQL health check failed: ${error.message}`, { cause: error });
  }
}

function databaseUrl(environment, database) {
  const host = environment.PGHOST ?? '127.0.0.1';
  const port = environment.PGPORT ?? '5432';
  const user = environment.PGUSER ?? 'postgres';
  const password = environment.PGPASSWORD;
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('PostgreSQL password must be supplied through the protected runner environment');
  }
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export async function withIsolatedDatabases({
  stateId,
  index,
  cwd,
  environment,
  runCommand = runTrustedCommand,
  action,
}) {
  await assertPostgresHealthy({ cwd, environment, runCommand });
  const names = databaseNames(stateId, index);
  const urls = {
    primary: databaseUrl(environment, names.primary),
    test: databaseUrl(environment, names.test),
  };
  const secrets = sensitiveValues(environment, urls.primary, urls.test);
  const created = [];
  let primaryFailure;
  try {
    for (const name of [names.primary, names.test]) {
      await runCommand(
        {
          executable: 'createdb',
          arguments: ['--maintenance-db=postgres', name],
        },
        { cwd, environment, sensitiveValues: secrets },
      );
      created.push(name);
    }
    return await action({
      environment: {
        ...environment,
        DATABASE_URL: urls.primary,
        TEST_DATABASE_URL: urls.test,
      },
      sensitiveValues: secrets,
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    for (const name of [...created].reverse()) {
      try {
        await runCommand(
          {
            executable: 'dropdb',
            arguments: ['--if-exists', '--force', '--maintenance-db=postgres', name],
          },
          { cwd, environment, sensitiveValues: secrets },
        );
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        primaryFailure === undefined
          ? cleanupFailures
          : [primaryFailure, ...cleanupFailures],
        'PostgreSQL state cleanup failed',
        { cause: primaryFailure ?? cleanupFailures[0] },
      );
    }
  }
}
