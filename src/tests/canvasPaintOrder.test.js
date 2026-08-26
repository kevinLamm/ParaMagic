import test from 'node:test';
import assert from 'node:assert/strict';
import {
  organizeDerivedPaintNodes,
  splitDerivedPresentationNodes,
} from '../../packages/paramagic-core/src/modules/CanvasPaintOrder.js';

const node = (dataset = {}) => ({ dataset });

test('derived paint nodes can bracket their source record in normal z-order', () => {
  const fill = node({ paintBeforeRecordId: 'swell-source' });
  const outline = node({ paintAfterRecordId: 'swell-source' });
  const unanchored = node();
  const result = organizeDerivedPaintNodes([outline, unanchored, fill]);

  assert.deepEqual(result.beforeByRecordId.get('swell-source'), [fill]);
  assert.deepEqual(result.afterByRecordId.get('swell-source'), [outline]);
  assert.deepEqual(result.unanchored, [unanchored]);
  assert.deepEqual([...result.anchorRecordIds], ['swell-source']);
});

test('copy and array templates place derived fills before source geometry', () => {
  const fill = node({ paintBeforeRecordId: 'swell-source' });
  const outline = node({ paintAfterRecordId: 'swell-source' });
  const result = splitDerivedPresentationNodes([outline, fill]);

  assert.deepEqual(result.before, [fill]);
  assert.deepEqual(result.after, [outline]);
});
