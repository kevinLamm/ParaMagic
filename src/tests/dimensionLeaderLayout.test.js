import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDrivenDimensionExportPersistence,
  dimensionExcludedFromExport,
  dimensionHiddenInTextMode,
  mclDimensionLayout,
  moveDimensionLine,
  radiusDimensionLayout,
  uprightDimensionControlPoint,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';

test('only driven dimensions explicitly disabled for export are excluded', () => {
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driven', excludeFromExport: true }), true);
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driven', excludeFromExport: false }), false);
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driving', excludeFromExport: true }), false);
});

test('value-only view hides driving and no-export driven dimensions only', () => {
  const driving = { dimensionMode: 'driving' };
  const includedDriven = { dimensionMode: 'driven', excludeFromExport: false };
  const excludedDriven = { dimensionMode: 'driven', excludeFromExport: true };

  assert.equal(dimensionHiddenInTextMode(driving, 'value'), true);
  assert.equal(dimensionHiddenInTextMode(includedDriven, 'value'), false);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'value'), true);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'named-value'), false);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'expression'), false);
});

test('driven dimension export preference persists through the solver annotation', () => {
  const updates = [];
  const changes = [];
  const persist = createDrivenDimensionExportPersistence({
    solver: {
      updateDimensionAnnotation(dimensionId, entity) {
        updates.push({ dimensionId, entity: structuredClone(entity) });
        return true;
      },
    },
    onChange: (entity) => changes.push(entity.dimensionId),
  });
  const entity = {
    dimensionId: 'dimension-width',
    dimensionMode: 'driven',
    excludeFromExport: true,
  };

  assert.equal(persist(entity), true);
  assert.deepEqual(updates, [{ dimensionId: 'dimension-width', entity }]);
  assert.deepEqual(changes, ['dimension-width']);
});

test('driven dimension export control follows rotated text without rotating itself', () => {
  const point = uprightDimensionControlPoint([30, 10], 'rotate(90 10 10)');

  assert.ok(Math.abs(point[0] - 10) < 1e-9);
  assert.ok(Math.abs(point[1] - 30) < 1e-9);
});

test('radius dimension text begins at the horizontal leader endpoint on initial placement', () => {
  const entity = {
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [30, -20],
    label: [30, -20],
  };

  const layout = radiusDimensionLayout(entity, 1);

  assert.deepEqual(layout.label, layout.landingEnd);
  assert.equal(layout.textAnchor, 'start');
});

test('radius arrowhead follows the leader when the elbow is inside the circle', () => {
  const layout = radiusDimensionLayout({
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [10, 0],
    label: [10, 0],
  }, 1);
  const values = layout.arrowA.match(/[-+]?\d+(?:\.\d+)?/g).map(Number);

  assert.deepEqual(values.slice(0, 2), [50, 0]);
  assert.ok(values[2] < values[0], 'arrowhead body should extend toward the elbow');
});

test('diameter dimension spans both circle edges and renders two arrowheads', () => {
  const layout = radiusDimensionLayout({
    type: 'radius-dimension',
    subtype: 'diameter',
    center: [0, 0],
    radius: 50,
    elbow: [80, 0],
    label: [80, 0],
  }, 1);

  assert.deepEqual(layout.oppositeTarget, [-50, 0]);
  assert.deepEqual(layout.target, [50, 0]);
  assert.match(layout.leaderPath, /^M -50 0 L 50 0 /);
  assert.notEqual(layout.arrowA, '');
  assert.notEqual(layout.arrowB, '');
});

test('multi-length dimension text ends at the horizontal leader endpoint on the left side', () => {
  const entity = {
    type: 'multi-curve-length-dimension',
    target: [100, 50],
    elbow: [40, 20],
    label: [40, 20],
  };

  const layout = mclDimensionLayout(entity, 1);

  assert.deepEqual(layout.label, layout.landingEnd);
  assert.equal(layout.textAnchor, 'end');
});

test('dragging a radius dimension keeps its text attached to the leader landing', () => {
  const entity = {
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [30, -20],
    label: [62, -20],
  };
  const record = {
    entity,
    path: { setAttribute() {} },
    pathHit: { setAttribute() {}, getAttribute() { return ''; } },
    arrowA: { setAttribute() {} },
    text: { setAttribute() {}, textContent: '' },
  };

  moveDimensionLine(record, [50, 10], [30, -20], structuredClone(entity), 1);

  const layout = radiusDimensionLayout(entity, 1);
  assert.deepEqual(entity.label, layout.landingEnd);
});
