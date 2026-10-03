/* CommonJS is required by the pinned Nx generator loader. */
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  addProjectConfiguration,
  getProjects,
  readJson,
  updateJson,
} = require('@nx/devkit');

const ALLOWED_OWNER = 'robdonn';
const RESERVED_NAMES = new Set([
  'eval',
  'arguments',
  'con',
  'prn',
  'aux',
  'nul',
  ...'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with let static yield await implements interface package private protected public'.split(' '),
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);
const ALLOWED_OPTIONS = new Set([
  'name',
  'type',
  'runtime',
  'scope',
  'owner',
  'dryRun',
  'interactive',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reject(message) {
  throw new Error(`Invalid library generator options: ${message}`);
}

function validateOptions(options) {
  if (!isRecord(options)) {
    reject('options must be an object');
  }

  for (const key of Object.keys(options)) {
    if (!ALLOWED_OPTIONS.has(key)) {
      reject(`unknown option "${key}"`);
    }
  }

  for (const key of ['name', 'type', 'runtime', 'scope', 'owner']) {
    if (typeof options[key] !== 'string' || options[key].length === 0) {
      reject(`${key} is required`);
    }
  }

  if (
    options.name.length > 63 ||
    options.name.includes('/') ||
    options.name.includes('\\') ||
    /^[a-zA-Z]:/.test(options.name) ||
    options.name.startsWith('/') ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.name) ||
    RESERVED_NAMES.has(options.name)
  ) {
    reject('name must be a safe lower-case kebab-case path segment');
  }

  if (!['domain', 'contract'].includes(options.type)) {
    reject('type must be domain or contract');
  }
  if (options.runtime !== 'universal') {
    reject('runtime must be universal');
  }
  if (!['rental', 'shared'].includes(options.scope)) {
    reject('scope must be rental or shared');
  }
  if (options.owner !== ALLOWED_OWNER) {
    reject(`owner must be ${ALLOWED_OWNER}`);
  }
  for (const key of ['dryRun', 'interactive']) {
    if (key in options && typeof options[key] !== 'boolean') {
      reject(`${key} must be boolean`);
    }
  }
}

function readCodeowners(tree) {
  let contents;
  try {
    contents = tree.read('.github/CODEOWNERS', 'utf8');
  } catch {
    reject('checked-in .github/CODEOWNERS is required');
  }
  if (typeof contents !== 'string') {
    contents = contents?.toString('utf8');
  }
  if (typeof contents !== 'string') {
    reject('checked-in .github/CODEOWNERS is required');
  }

  const owners = new Set();
  for (const line of contents.split(/\r?\n/)) {
    const tokens = line.replace(/#.*/, '').trim().split(/\s+/);
    if (tokens.length < 2 || !tokens[0]) continue;
    for (const token of tokens.slice(1)) {
      if (token.startsWith('@') && token.length > 1) {
        owners.add(token.slice(1));
      }
    }
  }
  if (!owners.has(ALLOWED_OWNER)) {
    reject(`owner ${ALLOWED_OWNER} is not present in CODEOWNERS`);
  }
}

function readBaseTsconfig(tree) {
  let config;
  try {
    config = readJson(tree, 'tsconfig.base.json');
  } catch {
    reject('tsconfig.base.json must contain valid JSON');
  }
  if (!isRecord(config)) {
    reject('tsconfig.base.json must be a JSON object');
  }
  if ('compilerOptions' in config && !isRecord(config.compilerOptions)) {
    reject('tsconfig.base.json compilerOptions must be an object');
  }
  if (
    isRecord(config.compilerOptions) &&
    'paths' in config.compilerOptions &&
    !isRecord(config.compilerOptions.paths)
  ) {
    reject('tsconfig.base.json compilerOptions.paths must be an object');
  }
  return config;
}

function camelCase(value) {
  return value.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
}

module.exports = async function libraryGenerator(tree, options) {
  validateOptions(options);

  const name = options.name;
  const root = `libs/${name}`;
  const projectName = `@madeup-video/${name}`;
  const alias = projectName;
  const baseTsconfig = readBaseTsconfig(tree);
  readCodeowners(tree);

  if (tree.read('libs') !== null) reject('libs ancestor must be a directory');
  const { lstatSync } = require('node:fs');
  const { join } = require('node:path');
  for (const ancestor of ['libs', root]) {
    try {
      const stat = lstatSync(join(tree.root, ancestor));
      if (stat.isSymbolicLink()) reject('symlink ancestor is unsafe');
      if (!stat.isDirectory()) reject('ancestor must be a directory');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    const stat = lstatSync(join(tree.root, 'tsconfig.base.json'));
    if (stat.isSymbolicLink()) reject('symlink tsconfig mutation destination is unsafe');
    if (!stat.isFile()) reject('tsconfig mutation destination must be a file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (tree.exists(root)) {
    reject(`project root ${root} is already occupied`);
  }

  let projects;
  try {
    projects = getProjects(tree);
  } catch {
    reject('workspace project configuration must be readable');
  }
  if (projects.has(projectName)) {
    reject(`project ${projectName} already exists`);
  }

  const paths = isRecord(baseTsconfig.compilerOptions)
    ? baseTsconfig.compilerOptions.paths
    : undefined;
  if (isRecord(paths) && Object.prototype.hasOwnProperty.call(paths, alias)) {
    reject(`path alias ${alias} already exists`);
  }

  if (options.dryRun) return;

  const functionName = camelCase(name);
  addProjectConfiguration(tree, projectName, {
    root,
    projectType: 'library',
    sourceRoot: `${root}/src`,
    tags: [`type:${options.type}`, 'runtime:universal', `scope:${options.scope}`],
    metadata: { owners: [ALLOWED_OWNER] },
    targets: {
      test: {
        executor: 'nx:run-commands',
        cache: false,
        options: {
          command: `node --import tsx --test ${root}/src/lib/${name}.test.ts`,
          cwd: '.',
        },
      },
      typecheck: {
        executor: 'nx:run-commands',
        options: {
          command: `node node_modules/typescript/bin/tsc --noEmit -p ${root}/tsconfig.json`,
          cwd: '.',
        },
      },
    },
  });

  tree.write(
    `${root}/tsconfig.json`,
    JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          types: ['node'],
          target: 'ES2022',
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ) + '\n',
  );
  tree.write(
    `${root}/src/lib/${name}.ts`,
    `export function ${functionName}<T>(value: T): T {\n  return value;\n}\n`,
  );
  tree.write(
    `${root}/src/index.ts`,
    `export { ${functionName} } from './lib/${name}';\n`,
  );
  tree.write(
    `${root}/src/lib/${name}.test.ts`,
    `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { ${functionName} } from './${name}';\n\ntest('${functionName} preserves input identity', () => {\n  const input = { value: '${name}' };\n  assert.strictEqual(${functionName}(input), input);\n});\n`,
  );

  updateJson(tree, 'tsconfig.base.json', (config) => ({
    ...config,
    compilerOptions: {
      ...(isRecord(config.compilerOptions) ? config.compilerOptions : {}),
      paths: {
        ...(isRecord(config.compilerOptions?.paths) ? config.compilerOptions.paths : {}),
        [alias]: [`./${root}/src/index.ts`],
      },
    },
  }));
};
