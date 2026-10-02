import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';

const cwd = process.cwd();
const require = createRequire(join(cwd, 'package.json'));
const environment = {
  ...process.env,
  NX_DAEMON: 'false',
  NX_NO_CLOUD: 'true',
  NX_PREFER_NODE_STRIP_TYPES: 'false',
  NODE_PATH: [
    join(cwd, 'node_modules/nx/node_modules'),
    join(cwd, 'node_modules'),
    join(cwd, 'node_modules/.pnpm/node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(delimiter),
};

// The ESLint boundary rule reads Nx's cached graph and file map. Refresh them
// in the execution directory before lint, including on a completely cold run.
const graph = spawnSync(process.execPath, [require.resolve('nx/bin/nx'), 'show', 'projects', '--json'], {
  cwd, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
if (graph.error || graph.status !== 0) {
  process.stderr.write(`Cannot initialize the Nx graph for module-boundary lint.\n${graph.error?.message ?? ''}${graph.stdout ?? ''}${graph.stderr ?? ''}`);
  process.exit(graph.status || 1);
}
process.stdout.write('Nx graph initialized for module-boundary lint.\n');

const requested = process.argv.slice(2);
if (requested[0] === '--') requested.shift();
const eslintBin = join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
const eslint = spawnSync(process.execPath, [eslintBin, ...(requested.length ? requested : ['.'])], {
  cwd, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  stdio: ['inherit', 'pipe', 'pipe'],
});
process.stdout.write(eslint.stdout ?? '');
process.stderr.write(eslint.stderr ?? '');
if (eslint.error) process.stderr.write(`${eslint.error.message}\n`);
if (/No cached ProjectGraph|rule will be skipped/i.test(`${eslint.stdout ?? ''}${eslint.stderr ?? ''}`)) {
  process.stderr.write('Module-boundary lint did not execute; refusing a passing result.\n');
  process.exit(1);
}
process.exit(eslint.error ? 1 : (eslint.status ?? 1));
