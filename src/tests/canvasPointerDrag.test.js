import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_DRAG_THRESHOLD_PX,
  canvasPointerDragDistance,
  canvasPointerDragReady,
} from '../../packages/paramagic-core/src/modules/CanvasPointerDrag.js';

test('ordinary click jitter does not enter canvas drag handling', () => {
  const drag = { startClientX: 100, startClientY: 200 };
  assert.equal(CANVAS_DRAG_THRESHOLD_PX, 4);
  assert.equal(canvasPointerDragDistance(drag, { clientX: 102, clientY: 202 }), Math.hypot(2, 2));
  assert.equal(canvasPointerDragReady(drag, { clientX: 102, clientY: 202 }), false);
});

test('canvas drag handling begins once movement reaches four screen pixels', () => {
  const drag = { startClientX: 100, startClientY: 200 };
  assert.equal(canvasPointerDragReady(drag, { clientX: 104, clientY: 200 }), true);
  assert.equal(canvasPointerDragReady(drag, { clientX: 103, clientY: 203 }), true);
});
