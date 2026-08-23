import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAutoConstraints,
  detectAutoConstraints,
  detectAutoConstraintsForEntities,
} from '../../packages/paramagic-core/src/modules/ConstraintSystem.js';

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

test('horizontal and vertical auto constraints use a 1.5 degree threshold', () => {
  const endpoint = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return [100 * Math.cos(radians), 100 * Math.sin(radians)];
  };
  const nearHorizontal = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: endpoint(1.49) },
    recordId: 'near-horizontal',
  });
  const outsideHorizontal = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: endpoint(1.51) },
    recordId: 'outside-horizontal',
  });
  const nearVertical = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: endpoint(90 - 1.49) },
    recordId: 'near-vertical',
  });
  const outsideVertical = detectAutoConstraints({
    entity: { type: 'line', start: [0, 0], end: endpoint(90 - 1.51) },
    recordId: 'outside-vertical',
  });
  assert.deepEqual(types(nearHorizontal), ['Horizontal']);
  assert.deepEqual(types(outsideHorizontal), []);
  assert.deepEqual(types(nearVertical), ['Vertical']);
  assert.deepEqual(types(outsideVertical), []);
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

test('commits every auto constraint from one rectangle in a single solver batch', () => {
  const batches = [];
  let individualAdds = 0;
  const solver = {
    applyConstraintBatch(batch) {
      batches.push(batch);
      return {
        committed: true,
        constraints: batch.constraints,
        result: { status: 'unchanged' },
        snapshot: [],
      };
    },
    addConstraint() {
      individualAdds += 1;
    },
  };

  const outcome = applyAutoConstraints({
    solver,
    entity: { type: 'polygon', points: [[0, 0], [20, 0], [20, 10], [0, 10]] },
    recordId: 'rectangle',
  });

  assert.equal(outcome.committed, true);
  assert.equal(batches.length, 1);
  assert.deepEqual(types(batches[0].constraints), ['Horizontal', 'Vertical', 'Horizontal', 'Vertical']);
  assert.equal(individualAdds, 0);
});

test('detects the complete editable rectangle chain as one eight-constraint transaction', () => {
  const ids = ['top', 'right', 'bottom', 'left'];
  const points = [[0, 0], [20, 0], [20, 10], [0, 10]];
  const entries = ids.map((id, index) => ({
    entity: {
      id,
      type: 'line',
      start: points[index],
      end: points[(index + 1) % points.length],
    },
    snapRefs: [
      index ? { recordId: ids[index - 1], index: 2, point: points[index] } : null,
      index === ids.length - 1 ? { recordId: ids[0], index: 0, point: points[0] } : null,
    ],
  }));

  const constraints = detectAutoConstraintsForEntities({ entries });

  assert.deepEqual(types(constraints), [
    'Horizontal',
    'Coincident', 'Vertical',
    'Coincident', 'Horizontal',
    'Coincident', 'Coincident', 'Vertical',
  ]);
});
