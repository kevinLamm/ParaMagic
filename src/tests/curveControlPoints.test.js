import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteCurveControlPoint,
  insertCurveControlPoint,
  isCurvePointDeleteGesture,
  remapCurvePointIndex,
} from '../../packages/paramagic-core/src/modules/DrawingTools.js';

test('Ctrl-click insertion adds a control point on the nearest curve segment', () => {
  const original = [[0, 0], [50, 80], [100, 0]];
  const result = insertCurveControlPoint(original, [75, 45]);
  assert.equal(result.points.length, 4);
  assert.ok(result.index === 1 || result.index === 2);
  assert.deepEqual(original, [[0, 0], [50, 80], [100, 0]]);
});

test('Ctrl+Alt-click deletion removes one curve handle but preserves a drawable curve', () => {
  const result = deleteCurveControlPoint([[0, 0], [25, 50], [50, 0]], 1);
  assert.deepEqual(result.points, [[0, 0], [50, 0]]);
  assert.equal(deleteCurveControlPoint(result.points, 0), null);
});

test('Curve deletion leaves Alt cycling and active constraint tools alone', () => {
  const click = { button: 0, altKey: true };
  assert.equal(Boolean(isCurvePointDeleteGesture(click)), false);
  assert.equal(Boolean(isCurvePointDeleteGesture({ ...click, shiftKey: true })), false);
  assert.equal(isCurvePointDeleteGesture({ ...click, ctrlKey: true }), true);
  assert.equal(isCurvePointDeleteGesture({ ...click, ctrlKey: true }, true), false);
});

test('curve point references shift with inserted and deleted handles', () => {
  assert.equal(remapCurvePointIndex(2, { type: 'insert', index: 1 }), 3);
  assert.equal(remapCurvePointIndex(2, { type: 'delete', index: 1 }), 1);
  assert.equal(remapCurvePointIndex(1, { type: 'delete', index: 1 }), null);
});
