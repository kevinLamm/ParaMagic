import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWindowSelectionIds } from '../../packages/paramagic-core/src/modules/CanvasSelection.js';

test('ordinary window selection replaces the existing selection', () => {
  assert.deepEqual(resolveWindowSelectionIds(['first'], ['second', 'third']), ['second', 'third']);
});

test('Ctrl window selection adds a new group to the existing selection', () => {
  assert.deepEqual(
    resolveWindowSelectionIds(['first'], ['second', 'third'], true),
    ['first', 'second', 'third'],
  );
});

test('Ctrl window selection toggles an already selected group like Ctrl pick selection', () => {
  assert.deepEqual(
    resolveWindowSelectionIds(['first', 'second', 'third'], ['second', 'third'], true),
    ['first'],
  );
  assert.deepEqual(
    resolveWindowSelectionIds(['first', 'second'], ['second', 'third'], true),
    ['first', 'second', 'third'],
  );
});
