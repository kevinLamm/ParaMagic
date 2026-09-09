import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWindowSelectionIds, canvasPointHandleHitDistance } from '../../packages/paramagic-core/src/modules/CanvasSelection.js';

test('the entire point perimeter is hittable without a parent geometry hover', () => {
  const handle = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 94, top: 94, width: 12, height: 12 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ opacity: '0', pointerEvents: 'none' }) } },
  };
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 4) {
    assert.ok(Number.isFinite(canvasPointHandleHitDistance(handle, 100 + 8.5 * Math.cos(angle), 100 + 8.5 * Math.sin(angle))));
  }
  assert.equal(canvasPointHandleHitDistance(handle, 110, 100), Infinity);
  handle.closest = () => ({});
  assert.equal(canvasPointHandleHitDistance(handle, 100, 100), Infinity, 'hidden and disabled records remain excluded');
});

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
