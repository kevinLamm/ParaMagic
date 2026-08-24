import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('both local launch commands use Vite for workspace package resolution', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const legacyLauncher = await readFile(new URL('../../scripts/dev-server.js', import.meta.url), 'utf8');

  assert.match(packageJson.scripts.dev, /\bvite\b/);
  assert.equal(packageJson.dependencies['@paramagic/core'], 'file:packages/paramagic-core');
  assert.match(legacyLauncher, /from ['"]vite['"]/);
  assert.doesNotMatch(legacyLauncher, /from ['"]node:http['"]/);
});
