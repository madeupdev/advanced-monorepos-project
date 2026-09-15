import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../..', import.meta.url));
const exec = promisify(execFile);

function projectGraphCommand(platform, commandInterpreter) {
  const args = ['exec', 'nx', 'show', 'projects', '--json'];

  if (platform === 'win32') {
    return {
      command: commandInterpreter,
      args: ['/d', '/s', '/c', 'pnpm.cmd', ...args],
    };
  }

  return { command: 'pnpm', args };
}

before(async () => {
  const { command, args } = projectGraphCommand(
    process.platform,
    process.env.ComSpec ?? 'cmd.exe',
  );

  await exec(command, args, {
    cwd: root,
    encoding: 'utf8',
  });
});

async function boundaryMessages(source, filePath) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath });

  return result.messages.filter(
    ({ ruleId }) => ruleId === '@nx/enforce-module-boundaries',
  );
}

test('rejects a browser project importing the database project', async () => {
  const messages = await boundaryMessages(
    "export { getDatabase } from '@madeup-video/database';\n",
    'libs/ui/src/server-import-violation.ts',
  );

  assert.equal(messages.length > 0, true);
  assert.match(
    messages.map(({ message }) => message).join('\n'),
    /runtime:browser|type:ui/,
  );
});

test('launches graph initialization through cmd.exe on Windows', () => {
  assert.deepEqual(projectGraphCommand('win32', 'cmd.exe'), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm.cmd', 'exec', 'nx', 'show', 'projects', '--json'],
  });

  assert.deepEqual(projectGraphCommand('darwin', 'cmd.exe'), {
    command: 'pnpm',
    args: ['exec', 'nx', 'show', 'projects', '--json'],
  });
});

test('rejects a cross-project relative import that bypasses the public entry point', async () => {
  const messages = await boundaryMessages(
    "export { getDatabase } from '../../../libs/database/src/lib/database';\n",
    'apps/storefront/app/server-import-violation.ts',
  );

  assert.equal(messages.length > 0, true);
  assert.match(
    messages.map(({ message }) => message).join('\n'),
    /relative or absolute path|npm scope|entry point/i,
  );
});

test('keeps server configuration imports separate from browser configuration', async () => {
  const [serverConfig, serverApi, apiConfig] = await Promise.all([
    readFile(new URL('../../apps/storefront/lib/config/server.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/storefront/lib/api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/app/config.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(serverConfig, /from\s+["'][^"']*browser["']/);
  assert.doesNotMatch(serverApi, /config\/browser/);
  assert.doesNotMatch(apiConfig, /NEXT_PUBLIC_|VITE_/);
});

test('browser configuration modules read only deliberately public variables', async () => {
  const [storefront, admin] = await Promise.all([
    readFile(new URL('../../apps/storefront/lib/config/browser.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/admin/src/config.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(storefront, /process\.env\.(?!NEXT_PUBLIC_)/);
  assert.doesNotMatch(storefront, /DATABASE_URL|(?:process\.env|environment)\.API_URL/);
  assert.doesNotMatch(admin, /process\.env|DATABASE_URL|NEXT_PUBLIC_/);
  assert.match(storefront, /NEXT_PUBLIC_API_URL/);
  assert.match(admin, /VITE_API_URL/);
});
