import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
test('configured Nx plugins are direct root dependencies at the workspace Nx release', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const nx = JSON.parse(await readFile(new URL('nx.json', root), 'utf8'));
  for (const entry of nx.plugins) {
    const plugin = typeof entry === 'string' ? entry : entry.plugin;
    const packageName = plugin.split('/').slice(0, 2).join('/');
    assert.equal(pkg.devDependencies[packageName], pkg.devDependencies.nx, plugin);
  }
});
