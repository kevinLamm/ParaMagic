import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureLength,
  featureTargetPoint,
  nearestDimensionFeature,
  resolveDimensionFeatureSet,
  transformDimensionFeatureSet,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';

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

test('derived feature sets transform persistent points and edges together', () => {
  const source = {
    recordId: 'source',
    entityType: 'line',
    controlPoints: [[0, 0], [5, 0], [10, 0]],
    features: [
      { kind: 'point', recordId: 'source', index: 0, point: [0, 0] },
      { kind: 'segment', recordId: 'source', index: 0, start: [0, 0], end: [10, 0] },
    ],
  };
  const derived = transformDimensionFeatureSet(source, ([x, y]) => [x + 20, y - 5], 'derived');

  assert.deepEqual(derived.controlPoints, [[20, -5], [25, -5], [30, -5]]);
  assert.deepEqual(resolveDimensionFeatureSet(derived, { kind: 'segment', index: 0 }), {
    kind: 'segment',
    recordId: 'derived',
    index: 0,
    start: [20, -5],
    end: [30, -5],
    node: null,
  });
});

test('derived feature picking prefers a nearby control point and otherwise chooses geometry', () => {
  const featureSet = {
    features: [
      { kind: 'point', recordId: 'derived', index: 0, point: [0, 0] },
      { kind: 'segment', recordId: 'derived', index: 0, start: [0, 0], end: [20, 0] },
    ],
  };
  assert.equal(nearestDimensionFeature([featureSet], [1, 1], { pointTolerance: 2 }).kind, 'point');
  assert.equal(nearestDimensionFeature([featureSet], [10, 1], { pointTolerance: 2 }).kind, 'segment');
});
