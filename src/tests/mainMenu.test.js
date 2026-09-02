import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

test('the Main Menu omits duplicate-drawing and legacy drawing-insert actions', () => {
  assert.doesNotMatch(mainSource, /appMenuButton\('Duplicate Drawing'/);
  assert.doesNotMatch(mainSource, /appMenuButton\('Insert',\s*'id="insertButton"/);
  assert.doesNotMatch(mainSource, /insertParamagicFileInput|insertParamagicFile\s*\(/);
});
