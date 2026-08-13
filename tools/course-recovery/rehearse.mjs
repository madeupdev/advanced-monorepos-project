#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  deriveArchiveLimits,
  inspectAndExtractArchive,
  verifyExtractedTree,
} from './archive.mjs';
import { auditBundle, compareBundleDirectories } from './bundle.mjs';
import {
  assertCommitReachable,
  validateRehearsalInputs,
} from './inputs.mjs';
import { withIsolatedDatabases } from './postgres.mjs';
import {
  createControlledEnvironment,
  runTrustedCommand,
  runTrustedStateCommands,
} from './process.mjs';

const exec = promisify(execFile);

export function builderRegister(register) {
  return {
    schemaVersion: register.schemaVersion,
    courseVersion: register.courseVersion,
    cliVersion: register.cliVersion,
    cli: register.cli,
    project: register.project,
    release: register.release,
    states: register.states.map((state) => ({
      id: state.id,
      sourceCommit: state.sourceCommit,
      asset: state.asset,
      sha256: state.sha256,
      status: state.status,
      verification: state.verification,
    })),
    recipes: register.recipes.map((recipe) => {
      const publicRecipe = { ...recipe };
      delete publicRecipe.authoringNotes;
      return publicRecipe;
    }),
  };
}

async function runGit(repository, args) {
  try {
    const result = await exec('git', args, {
      cwd: repository,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        LANG: 'C',
        LC_ALL: 'C',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
      },
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message),
    };
  }
}

async function defaultBuild({
  outputDirectory,
  registerPath,
  projectDirectory,
  cliBuilderPath,
  cwd,
  baseEnvironment,
}) {
  const installedBuilderPath = await realpath(cliBuilderPath);
  await runTrustedCommand(
    {
      executable: process.execPath,
      arguments: [
        installedBuilderPath,
        '--project',
        projectDirectory,
        '--register',
        registerPath,
        '--output',
        outputDirectory,
      ],
    },
    {
      cwd,
      environment: {
        PATH: baseEnvironment.PATH,
        HOME: baseEnvironment.HOME ?? cwd,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
      sensitiveValues: [],
    },
  );
}

function completeAdapters(overrides = {}) {
  return {
    validateRegister: async (value) => value,
    assertProjectCommitReachable: ({ projectDirectory, commit }) =>
      assertCommitReachable({
        repository: projectDirectory,
        commit,
        ref: 'origin/main',
        label: 'Registered project commit',
        git: runGit,
      }),
    build: defaultBuild,
    audit: auditBundle,
    compare: compareBundleDirectories,
    deriveLimits: deriveArchiveLimits,
    extract: inspectAndExtractArchive,
    verifyTree: verifyExtractedTree,
    withDatabases: withIsolatedDatabases,
    runStateCommands: runTrustedStateCommands,
    writeBuilderRegister: (path, contents) => writeFile(path, contents, { mode: 0o600 }),
    ...overrides,
  };
}

async function copyArtifactBundle(source, destination, names) {
  await mkdir(destination, { mode: 0o700 });
  try {
    for (const name of names) {
      await copyFile(join(source, name), join(destination, name));
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function runRecoveryRehearsal({
  register: unvalidatedRegister,
  projectDirectory,
  cliBuilderPath,
  outputDirectory,
  temporaryParent = tmpdir(),
  baseEnvironment,
  adapters: adapterOverrides,
}) {
  const adapters = completeAdapters(adapterOverrides);
  const register = await adapters.validateRegister(unvalidatedRegister);

  for (const state of register.states) {
    await adapters.assertProjectCommitReachable({
      projectDirectory,
      commit: state.sourceCommit,
    });
  }

  const root = await mkdtemp(join(temporaryParent, 'course-recovery-rehearsal-'));
  try {
    const firstBuild = join(root, 'build-first');
    const secondBuild = join(root, 'build-second');
    const privateBuilderRegister = builderRegister(register);
    const registerPath = join(root, 'builder-register.json');
    await adapters.writeBuilderRegister(
      registerPath,
      `${JSON.stringify(privateBuilderRegister, null, 2)}\n`,
    );
    const buildOptions = {
      register: privateBuilderRegister,
      registerPath,
      projectDirectory,
      cliBuilderPath,
      cwd: root,
      baseEnvironment,
    };
    await adapters.build({ ...buildOptions, outputDirectory: firstBuild });
    await adapters.build({ ...buildOptions, outputDirectory: secondBuild });
    const firstAudit = await adapters.audit(firstBuild, register);
    await adapters.audit(secondBuild, register);
    await adapters.compare(firstBuild, secondBuild, firstAudit.names);

    for (const [index, state] of register.states.entries()) {
      const stateRoot = join(root, `state-${String(index).padStart(3, '0')}`);
      const destination = join(stateRoot, 'tree');
      const home = join(stateRoot, 'home');
      const cache = join(stateRoot, 'cache');
      await mkdir(stateRoot, { mode: 0o700 });
      await mkdir(home, { mode: 0o700 });
      await mkdir(cache, { mode: 0o700 });
      try {
        const limits = await adapters.deriveLimits({
          repository: projectDirectory,
          commit: state.sourceCommit,
        });
        await adapters.extract({
          archivePath: join(firstBuild, state.asset),
          destination,
          limits,
        });
        await adapters.verifyTree({
          repository: projectDirectory,
          commit: state.sourceCommit,
          destination,
        });
        await adapters.withDatabases({
          stateId: state.id,
          index,
          cwd: stateRoot,
          environment: baseEnvironment,
          action: async ({ environment, sensitiveValues }) => {
            const controlled = createControlledEnvironment({
              inherited: baseEnvironment,
              home,
              cache,
              databaseUrl: environment.DATABASE_URL,
              testDatabaseUrl: environment.TEST_DATABASE_URL,
            });
            await adapters.runStateCommands(state, {
              cwd: destination,
              environment: controlled,
              sensitiveValues,
            });
          },
        });
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    }

    await copyArtifactBundle(firstBuild, outputDirectory, firstAudit.names);
    return firstAudit;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function loadValidatedRegister({ registerPath, validatorPath }) {
  const source = await readFile(registerPath, 'utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Private authoring register must contain valid JSON');
  }
  const validator = await import(pathToFileURL(resolve(validatorPath)).href);
  if (typeof validator.validateDeliveryStates !== 'function') {
    throw new Error('Private authoring validator does not export validateDeliveryStates');
  }
  const result = validator.validateDeliveryStates(value);
  if (!result.ok) {
    const format = validator.formatDeliveryStateIssues;
    const detail = typeof format === 'function'
      ? format(result.issues)
      : 'Private authoring register validation failed';
    throw new Error(`Private authoring register validation failed:\n${detail}`);
  }
  return result.value;
}

function parseArguments(argv) {
  const allowed = new Set([
    '--register',
    '--validator',
    '--authoring',
    '--project',
    '--cli-builder',
    '--output',
    '--course-version',
    '--authoring-commit',
    '--cli-version',
    '--cli-tag',
    '--cli-sha256',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option) || value === undefined || values.has(option)) {
      throw new Error('Invalid recovery rehearsal arguments');
    }
    values.set(option, value);
  }
  if (values.size !== allowed.size) throw new Error('Missing recovery rehearsal arguments');
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const exactInputs = validateRehearsalInputs({
    courseVersion: args.get('--course-version'),
    authoringCommit: args.get('--authoring-commit'),
    cliVersion: args.get('--cli-version'),
    cliTag: args.get('--cli-tag'),
    cliSha256: args.get('--cli-sha256'),
  });
  const authoringDirectory = resolve(args.get('--authoring'));
  await assertCommitReachable({
    repository: authoringDirectory,
    commit: exactInputs.authoringCommit,
    ref: 'origin/main',
    label: 'Authoring commit',
    git: runGit,
  });
  const register = await loadValidatedRegister({
    registerPath: resolve(args.get('--register')),
    validatorPath: resolve(args.get('--validator')),
  });
  if (register.courseVersion !== exactInputs.courseVersion) {
    throw new Error('Requested course version does not match the private register');
  }
  const result = await runRecoveryRehearsal({
    register,
    projectDirectory: resolve(args.get('--project')),
    cliBuilderPath: resolve(args.get('--cli-builder')),
    outputDirectory: resolve(args.get('--output')),
    baseEnvironment: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PGHOST: process.env.PGHOST,
      PGPORT: process.env.PGPORT,
      PGUSER: process.env.PGUSER,
      PGPASSWORD: process.env.PGPASSWORD,
    },
  });
  process.stdout.write(`Rehearsed ${String(result.assets.length)} recovery states.\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
