import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCanvasZoom,
  bindCanvasKeyboardFocus,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  cameraContainsBounds,
  fitCameraBounds,
} from '../../packages/paramagic-core/src/modules/CanvasViewport.js';

test('conditional fitting keeps a visible drawing steady and detects overflow on every edge', () => {
  const camera = { x: 100, y: 100, scale: 2, rotation: 0 };
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  assert.equal(cameraContainsBounds(camera, bounds, 400, 300), true);
  for (const changed of [{ x: -60 }, { y: -60 }, { width: 160 }, { height: 100 }]) {
    const expanded = { ...bounds, ...changed };
    assert.equal(cameraContainsBounds(camera, expanded, 400, 300), false);
    assert.equal(cameraContainsBounds(fitCameraBounds(camera, expanded, 400, 300), expanded, 400, 300), true);
  }
  assert.equal(cameraContainsBounds(camera, bounds, 0, 0), false);
});

test('conditional fitting checks rotated drawing corners in screen space', () => {
  const camera = { x: 100, y: 100, scale: 2, rotation: Math.PI / 2 };
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  assert.equal(cameraContainsBounds(camera, bounds, 400, 300), false);
  assert.equal(cameraContainsBounds(fitCameraBounds(camera, bounds, 400, 300), bounds, 400, 300), true);
});

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
