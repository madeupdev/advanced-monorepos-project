import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../..', import.meta.url));

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
