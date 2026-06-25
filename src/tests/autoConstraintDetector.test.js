import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAutoConstraints } from '../modules/AutoConstraintDetector.js';

function types(result) {
  return result.map((constraint) => constraint.type);
}

test('detects horizontal and vertical segments at commit time', () => {
  const horizontal = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: [100, 2] },
    recordId: 'new-horizontal',
  });
  const vertical = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: [2, 100] },
    recordId: 'new-vertical',
  });
  assert.deepEqual(types(horizontal), ['Horizontal']);
  assert.deepEqual(types(vertical), ['Vertical']);
});

test('detects the closest parallel or perpendicular existing segment', () => {
  const existingEntities = [{ id: 'reference', type: 'line', start: [0, 0], end: [100, 50] }];
  const parallel = detectAutoConstraints({
    entity: { type: 'line', start: [0, 30], end: [100, 80] },
    recordId: 'parallel',
    existingEntities,
  });
  const perpendicular = detectAutoConstraints({
    entity: { type: 'line', start: [0, 30], end: [-50, 130] },
    recordId: 'perpendicular',
    existingEntities,
  });
  assert.deepEqual(types(parallel), ['Parallel']);
  assert.deepEqual(types(perpendicular), ['Perpendicular']);
  assert.equal(parallel[0].featureRefs[1].recordId, 'reference');
});

test('creates Coincident only from an explicit object snap', () => {
  const existingEntities = [{ id: 'target', type: 'line', start: [0, 0], end: [50, 0] }];
  const entity = { type: 'line', start: [50, 0], end: [70, 20] };
  const withoutSnap = detectAutoConstraints({ entity, recordId: 'new-line', existingEntities });
  const withSnap = detectAutoConstraints({
    entity,
    recordId: 'new-line',
    existingEntities,
    snapRefs: [{ recordId: 'target', index: 2, point: [50, 0] }, null],
  });
  assert.equal(types(withoutSnap).includes('Coincident'), false);
  assert.equal(types(withSnap).includes('Coincident'), true);
  const coincident = withSnap.find((constraint) => constraint.type === 'Coincident');
  assert.deepEqual(coincident.featureRefs, [
    { kind: 'point', recordId: 'new-line', index: 0 },
    { kind: 'point', recordId: 'target', index: 2 },
  ]);
});

test('maps a rectangle second click to its opposite corner', () => {
  const result = detectAutoConstraints({
    entity: { type: 'polygon', points: [[0, 0], [20, 0], [20, 10], [0, 10]] },
    recordId: 'rectangle',
    existingEntities: [{ id: 'target', type: 'line', start: [20, 10], end: [40, 10] }],
    snapRefs: [null, { recordId: 'target', index: 0, point: [20, 10] }],
  });
  const coincident = result.find((constraint) => constraint.type === 'Coincident');
  assert.equal(coincident.featureRefs[0].index, 2);
});

test('detects concentric circles and arcs using their derived centers', () => {
  const result = detectAutoConstraints({
    entity: { type: 'arc', start: [10, 0], arcPoint: [0, 10], end: [-10, 0] },
    recordId: 'arc',
    existingEntities: [{ id: 'circle', type: 'circle', center: [0.5, 0.5], radius: 20 }],
    worldTolerance: 1,
  });
  assert.deepEqual(types(result), ['Concentric']);
  assert.deepEqual(result[0].featureRefs, [
    { kind: 'arc', recordId: 'arc' },
    { kind: 'circle', recordId: 'circle' },
  ]);
});
