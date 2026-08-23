import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCanvasZoom,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '../../packages/paramagic-core/src/modules/CanvasViewport.js';

test('canvas zoom supports a one-half-percent minimum scale', () => {
  assert.equal(MIN_CANVAS_ZOOM, 0.005);
  assert.equal(clampCanvasZoom(0.0001), MIN_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(0.02), 0.02);
});

test('canvas zoom retains its maximum and rejects non-finite values', () => {
  assert.equal(clampCanvasZoom(MAX_CANVAS_ZOOM * 2), MAX_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(Number.NaN), 1);
});
