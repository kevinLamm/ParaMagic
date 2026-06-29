import test from 'node:test';
import assert from 'node:assert/strict';
import { featureLength, featureTargetPoint } from '../modules/DimensionFeatureGeometry.js';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);

test('feature geometry helpers measure arcs and pick their midpoint target', () => {
  const arc = {
    kind: 'arc',
    center: [0, 0],
    radius: 10,
    start: [10, 0],
    arcPoint: [Math.sqrt(50), Math.sqrt(50)],
    end: [0, 10],
  };

  near(featureLength(arc), Math.PI * 5);
  const target = featureTargetPoint(arc);
  near(target[0], Math.sqrt(50));
  near(target[1], Math.sqrt(50));
});

test('feature geometry helpers cover line-like and circular targets', () => {
  assert.deepEqual(
    featureTargetPoint({ kind: 'segment', start: [0, 0], end: [10, 4] }),
    [5, 2],
  );
  assert.deepEqual(
    featureTargetPoint({ kind: 'circle', center: [4, 5], radius: 6 }),
    [10, 5],
  );
  near(featureLength({ kind: 'circle', center: [0, 0], radius: 2 }), Math.PI * 4);
});
