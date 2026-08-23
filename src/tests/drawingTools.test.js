import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEditableLineChain,
  drawingArcFromPoints,
  drawingGeometryHitTargetClass,
} from '../../packages/paramagic-core/src/modules/DrawingTools.js';
import { createGeometryBinding } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';

test('editable closed line chains match the Polyline tool segment representation', () => {
  const additions = [];
  const records = addEditableLineChain({
    chainPoints: [[0, 0], [20, 0], [20, 10], [0, 10]],
    closed: true,
    kind: 'polyline',
    addObject(entity, options) {
      const record = { id: `trace-edge-${additions.length}`, entity };
      additions.push({ entity, options, record });
      return record;
    },
  });

  assert.equal(records.length, 4);
  assert.deepEqual(additions.map(({ entity }) => entity.type), ['line', 'line', 'line', 'line']);
  assert.deepEqual(additions.map(({ entity }) => [entity.start, entity.end]), [
    [[0, 0], [20, 0]],
    [[20, 0], [20, 10]],
    [[20, 10], [0, 10]],
    [[0, 10], [0, 0]],
  ]);
  const compositeIds = new Set(additions.map(({ entity }) => entity.composite.id));
  assert.equal(compositeIds.size, 1);
  additions.forEach(({ entity }, index) => {
    assert.deepEqual(entity.composite, {
      id: entity.composite.id,
      kind: 'polyline',
      closed: true,
      index,
      count: 4,
    });
  });
  assert.equal(additions[1].options.snapRefs[0].recordId, 'trace-edge-0');
  assert.equal(additions[3].options.snapRefs[0].recordId, 'trace-edge-2');
  assert.equal(additions[3].options.snapRefs[1].recordId, 'trace-edge-0');
});

test('every traced line segment exposes the standard midpoint feature', () => {
  const entities = [];
  addEditableLineChain({
    chainPoints: [[0, 0], [12, 0], [12, 8]],
    closed: true,
    addObject(entity) {
      entities.push(entity);
      return { id: `edge-${entities.length}`, entity };
    },
  });
  assert.deepEqual(createGeometryBinding({ id: 'trace-line', ...entities[0] }).pointFeature(1), [6, 0]);
  assert.deepEqual(createGeometryBinding({ id: 'trace-line-2', ...entities[1] }).pointFeature(1), [12, 4]);
});

test('editable line chains can stage every segment through one canvas transaction', () => {
  const batches = [];
  const records = addEditableLineChain({
    chainPoints: [[0, 0], [20, 0], [20, 10], [0, 10]],
    closed: true,
    kind: 'rectangle',
    addObject() {
      throw new Error('The per-segment path should not run when batch creation is available.');
    },
    addObjects(entries) {
      batches.push(entries);
      return entries.map(({ entity }) => ({ id: entity.id, entity }));
    },
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  assert.equal(records.length, 4);
  assert.equal(new Set(batches[0].map(({ entity }) => entity.id)).size, 4);
  assert.equal(batches[0][1].snapRefs[0].recordId, batches[0][0].entity.id);
  assert.equal(batches[0][3].snapRefs[0].recordId, batches[0][2].entity.id);
  assert.equal(batches[0][3].snapRefs[1].recordId, batches[0][0].entity.id);
});

test('circle hit targets cover the region for standard and construction circles', () => {
  assert.equal(drawingGeometryHitTargetClass({ type: 'circle' }), 'circle-region-hit');
  assert.equal(drawingGeometryHitTargetClass({ type: 'circle', construction: true }), 'circle-region-hit');
  assert.equal(drawingGeometryHitTargetClass({ type: 'line' }), '');
});

test('drawn arcs record their point-order direction', () => {
  assert.equal(drawingArcFromPoints([10, 0], [0, 10], [-10, 0]).ccw, true);
  assert.equal(drawingArcFromPoints([10, 0], [0, -10], [-10, 0]).ccw, false);
});
