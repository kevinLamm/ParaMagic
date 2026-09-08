import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCanvasZoom,
  bindCanvasKeyboardFocus,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '../../packages/paramagic-core/src/modules/CanvasViewport.js';

test('canvas selection takes keyboard focus before drag handlers suppress default focus', () => {
  let handler;
  let focused = 0;
  const canvas = {
    addEventListener(type, callback, capture) {
      assert.equal(type, 'pointerdown');
      assert.equal(capture, true);
      handler = callback;
    },
    removeEventListener(type, callback, capture) {
      assert.equal(callback, handler);
      assert.equal(capture, true);
    },
    focus(options) { assert.deepEqual(options, { preventScroll: true }); focused++; },
  };
  const dispose = bindCanvasKeyboardFocus(canvas);
  assert.equal(canvas.tabIndex, -1);
  handler({ button: 0, target: { closest: () => null } });
  assert.equal(focused, 1);
  handler({ button: 0, target: { closest: () => ({}) } });
  handler({ button: 1, target: { closest: () => null } });
  assert.equal(focused, 1, 'editing controls and panning retain their focus');
  dispose();
});

test('canvas zoom supports a one-half-percent minimum scale', () => {
  assert.equal(MIN_CANVAS_ZOOM, 0.005);
  assert.equal(clampCanvasZoom(0.0001), MIN_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(0.02), 0.02);
});

test('canvas zoom retains its maximum and rejects non-finite values', () => {
  assert.equal(clampCanvasZoom(MAX_CANVAS_ZOOM * 2), MAX_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(Number.NaN), 1);
});
