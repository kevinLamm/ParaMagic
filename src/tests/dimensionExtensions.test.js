import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateFromSelections,
  createDimensionLinkManager,
  distanceDimensionLayout,
  finishDimensionLineMove,
  moveDimensionLine,
  syncDimensionStackFrames,
  upgradeLegacyParallelEdgeDimensions,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { transformStackEntity } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

const first = { kind: 'segment', recordId: 'a', index: 0, start: [0, 0], end: [100, 0] };
const second = { kind: 'segment', recordId: 'b', index: 0, start: [20, 60], end: [140, 60] };

for (const mode of ['driven','driving']) {
  test(`${mode} line extensions use closest endpoints on either side with a screen-sized gap`, () => {
    const right = candidateFromSelections([first,second], [200,30], mode);
    const left = candidateFromSelections([first,second], [-100,30], mode);
    assert.equal(right.offsetDistance, 60);
    assert.equal(right.offsetDirection[0], 1);
    assert.equal(Math.abs(right.offsetDirection[1]), 0);
    assert.equal(left.offsetDistance, 120);
    assert.equal(left.offsetDirection[0], -1);
    for (const scale of [0.5, 1, 2]) {
      const layout = distanceDimensionLayout(right, scale);
      assert.deepEqual(layout.extensionA.start, [100 + 6 / scale, 0]);
      assert.deepEqual(layout.extensionB.start, [140 + 6 / scale, 60]);
      const leftLayout = distanceDimensionLayout(left, scale);
      assert.deepEqual(leftLayout.extensionA.start, [-6 / scale, 0]);
      assert.deepEqual(leftLayout.extensionB.start, [20 - 6 / scale, 60]);
    }
    assert.equal(right.measuredValue, left.measuredValue);
    const frame = { x: 30, y: 50, rotation: 0.7 };
    const restored = transformStackEntity(transformStackEntity(right, frame), frame, true);
    const layout = distanceDimensionLayout(restored, 1);
    assert.ok(Math.hypot(layout.extensionA.start[0] - 106, layout.extensionA.start[1]) < 1e-9);
  });
}

test('a parallel dimension keeps following its selected endpoint after geometry changes', () => {
  const reference = {
    id: first.recordId,
    recordType: 'geometry',
    entity: { type: 'line', start: [...first.start], end: [...first.end] },
  };
  const measured = {
    id: second.recordId,
    recordType: 'geometry',
    entity: { type: 'line', start: [...second.start], end: [...second.end] },
  };
  const node = () => {
    const attributes = new Map();
    return {
      textContent: '',
      style: {},
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name) || ''; },
    };
  };
  const candidate = candidateFromSelections([first, second], [200, 30], 'driven');
  const dimension = {
    id: 'parallel-dimension',
    recordType: 'dimension',
    entity: { ...candidate, id: 'parallel-dimension' },
    extensionA: node(),
    extensionB: node(),
    path: node(),
    pathHit: node(),
    arrowA: node(),
    arrowB: node(),
    text: node(),
  };
  const records = [reference, measured, dimension];
  const manager = createDimensionLinkManager({
    records,
    recordById: (id) => records.find((record) => record.id === id) || null,
    recordHandles: (entity) => entity.type === 'line' ? [entity.start, entity.end] : [],
    recordSegments: (entity) => entity.type === 'line'
      ? [{ index: 0, start: entity.start, end: entity.end }]
      : [],
    renderedEntityForRecord: (record) => record.entity,
    filletEvaluation: () => ({ valid: false }),
    arcCircle: () => null,
    screenToWorld: () => [0, 0],
    formatDrawingLength: (value) => String(value),
    solver: { drawingUnit: 'in', dimensions: { setComputedValue() {} } },
    applyManagedDimensionText() {},
    updateRecordHandles() {},
    syncScreenInvariantSizing() {},
    getScale: () => 1,
  });

  assert.equal(dimension.entity.anchors.lineToLine.measuredEndpoint, 'end');
  assert.deepEqual(dimension.entity.measureEnd, [140, 60]);

  measured.entity.end = [220, 60];
  manager.refreshLinkedDimensions(new Set([measured.id]));

  assert.ok(Math.hypot(
    dimension.entity.measureStart[0] - 220,
    dimension.entity.measureStart[1],
  ) < 1e-9);
  assert.deepEqual(dimension.entity.measureEnd, [220, 60]);
  assert.equal(dimension.entity.offsetDistance, 60);
  assert.ok(Math.abs(dimension.entity.offsetDirection[0] - 1) < 1e-9);
  assert.ok(Math.abs(dimension.entity.offsetDirection[1]) < 1e-9);
  const pathValues = dimension.path.getAttribute('d').match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number);
  assert.ok(Math.hypot(pathValues[0] - 280, pathValues[1]) < 1e-9);
  assert.ok(Math.hypot(pathValues[2] - 280, pathValues[3] - 60) < 1e-9);

  measured.entity.start = [400, 60];
  manager.refreshLinkedDimensions(new Set([measured.id]));

  assert.deepEqual(dimension.entity.measureEnd, [220, 60]);
  assert.deepEqual(distanceDimensionLayout(dimension.entity, 1).extensionB.start, [226, 60]);
});

test('loading a midpoint-based parallel dimension records the closest endpoint choices', () => {
  const annotation = candidateFromSelections([first, second], [200, 30], 'driven');
  delete annotation.anchors.lineToLine.referenceEndpoint;
  delete annotation.anchors.lineToLine.measuredEndpoint;
  annotation.measureStart = [80, 0];
  annotation.measureEnd = [80, 60];

  const upgraded = upgradeLegacyParallelEdgeDimensions({
    entities: [
      { id: first.recordId, type: 'line', start: first.start, end: first.end },
      { id: second.recordId, type: 'line', start: second.start, end: second.end },
    ],
    dimensionAnnotations: [annotation],
  }).dimensionAnnotations[0];

  assert.equal(upgraded.anchors.lineToLine.referenceEndpoint, 'end');
  assert.equal(upgraded.anchors.lineToLine.measuredEndpoint, 'end');
  assert.deepEqual(upgraded.measureStart, [140, 0]);
  assert.deepEqual(upgraded.measureEnd, [140, 60]);
});

test('a linked diameter keeps its direction and circumference gap as its circle changes', () => {
  const circleFeature = {
    kind: 'circle', recordId: 'circle', center: [0, 0], radius: 50,
  };
  const circle = {
    id: circleFeature.recordId,
    recordType: 'geometry',
    entity: { type: 'circle', center: [...circleFeature.center], radius: circleFeature.radius },
  };
  const node = () => {
    const attributes = new Map();
    return {
      textContent: '',
      style: {},
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name) || ''; },
    };
  };
  const dimension = {
    id: 'diameter-dimension',
    recordType: 'dimension',
    entity: {
      ...candidateFromSelections([circleFeature], [80, 0], 'driven'),
      id: 'diameter-dimension',
    },
    path: node(),
    pathHit: node(),
    arrowA: node(),
    arrowB: node(),
    text: node(),
  };
  const records = [circle, dimension];
  const manager = createDimensionLinkManager({
    records,
    recordById: (id) => records.find((record) => record.id === id) || null,
    recordHandles: () => [],
    recordSegments: () => [],
    renderedEntityForRecord: (record) => record.entity,
    filletEvaluation: () => ({ valid: false }),
    arcCircle: () => null,
    screenToWorld: () => [0, 0],
    formatDrawingLength: (value) => String(value),
    solver: { drawingUnit: 'in', dimensions: { setComputedValue() {} } },
    applyManagedDimensionText() {},
    updateRecordHandles() {},
    syncScreenInvariantSizing() {},
    getScale: () => 1,
  });

  assert.deepEqual(dimension.entity.offsetDirection, [1, 0]);
  assert.equal(dimension.entity.offsetDistance, 30);

  circle.entity.radius = 90;
  manager.refreshLinkedDimensions(new Set([circle.id]));

  assert.deepEqual(dimension.entity.elbow, [120, 0]);
  assert.deepEqual(dimension.entity.label, [152, 0]);
  assert.equal(dimension.path.getAttribute('d'), 'M -90 0 L 90 0 L 120 0 L 152 0');

  circle.entity.center = [20, 10];
  manager.refreshLinkedDimensions(new Set([circle.id]));

  assert.deepEqual(dimension.entity.elbow, [140, 10]);
  assert.deepEqual(dimension.entity.offsetDirection, [1, 0]);
  assert.equal(dimension.entity.offsetDistance, 30);
});

test('loading a radial dimension records its current direction and circumference gap', () => {
  const legacy = {
    type: 'radius-dimension',
    subtype: 'diameter',
    center: [10, 20],
    radius: 25,
    elbow: [10, -20],
    label: [42, -20],
  };

  const upgraded = upgradeLegacyParallelEdgeDimensions({
    dimensionAnnotations: [legacy],
  }).dimensionAnnotations[0];

  assert.deepEqual(upgraded.offsetDirection, [0, -1]);
  assert.equal(upgraded.offsetDistance, 15);
  assert.equal(legacy.offsetDirection, undefined);
});

test('a saved length-dimension direction prevents an anchor-order flip', () => {
  const entity = candidateFromSelections([first], [50, -40], 'driven');
  assert.deepEqual(entity.offsetDirection, [0, -1]);

  entity.start = [100, 0];
  entity.end = [0, 0];
  entity.measureStart = [100, 0];
  entity.measureEnd = [0, 0];
  entity.label = [50, 40];

  const layout = distanceDimensionLayout(entity, 1);
  assert.deepEqual(layout.dimensionStart, [100, -40]);
  assert.deepEqual(layout.dimensionEnd, [0, -40]);
});

test('a saved length-dimension distance survives parameter-driven anchor changes', () => {
  const entity = candidateFromSelections([first], [50, -40], 'driving');
  assert.equal(entity.offsetDistance, 40);

  entity.start = [0, 0];
  entity.end = [240, 0];
  entity.measureStart = [0, 0];
  entity.measureEnd = [240, 0];

  const layout = distanceDimensionLayout(entity, 1);
  assert.deepEqual(layout.dimensionStart, [0, -40]);
  assert.deepEqual(layout.dimensionEnd, [240, -40]);
});

test('dragging a length dimension across its anchor records the newly chosen direction', () => {
  const entity = candidateFromSelections([first], [50, -40], 'driven');
  const node = () => ({ style: {}, setAttribute() {}, getAttribute() { return ''; } });
  const record = {
    entity,
    group: node(),
    extensionA: node(),
    extensionB: node(),
    path: node(),
    pathHit: node(),
    arrowA: node(),
    arrowB: node(),
    text: { ...node(), textContent: '' },
  };

  moveDimensionLine(record, [50, 40], [50, -40], structuredClone(entity), 1);

  assert.equal(Math.abs(entity.offsetDirection[0]), 0);
  assert.equal(entity.offsetDirection[1], 1);
  assert.deepEqual(distanceDimensionLayout(entity, 1).dimensionStart, [0, 40]);
});

test('finishing a length-dimension drag persists its distance and direction', () => {
  const entity = candidateFromSelections([first], [50, -40], 'driven');
  entity.dimensionId = 'dimension-value';
  entity.label = [50, 40];
  entity.offsetDirection = [0, 1];
  let stored = null;

  const updated = finishDimensionLineMove({ entity }, {
    updateDimensionAnnotation(dimensionId, annotation) {
      stored = { dimensionId, annotation: structuredClone(annotation) };
      return true;
    },
  });

  assert.equal(updated, true);
  assert.equal(stored.dimensionId, 'dimension-value');
  assert.deepEqual(stored.annotation.label, [50, 40]);
  assert.deepEqual(stored.annotation.offsetDirection, [0, 1]);
  assert.equal(stored.annotation.offsetDistance, 40);
});

test('a saved drawing round trip retains the length-dimension placement direction', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line', type: 'line', start: [0, 0], end: [100, 0] });
  const candidate = candidateFromSelections([{
    ...first,
    recordId: line.id,
    entityType: 'line',
  }], [50, -40], 'driven');
  const added = controller.addDimension(candidate).entity;
  const snapshot = controller.getSketchSnapshot();
  const restored = createSolverController();

  restored.loadSketch(snapshot);

  const annotation = restored.getSketchSnapshot().dimensionAnnotations
    .find(({ dimensionId }) => dimensionId === added.dimensionId);
  assert.deepEqual(annotation.offsetDirection, [0, -1]);
  assert.equal(annotation.offsetDistance, 40);
});

test('loading a legacy length dimension records its current placement direction', () => {
  const legacy = {
    type: 'dimension-line',
    subtype: 'horizontal',
    start: [0, 0],
    end: [100, 0],
    measureStart: [0, 0],
    measureEnd: [100, 0],
    label: [50, -40],
  };

  const upgraded = upgradeLegacyParallelEdgeDimensions({
    dimensionAnnotations: [legacy],
  }).dimensionAnnotations[0];

  assert.deepEqual(upgraded.offsetDirection, [0, -1]);
  assert.equal(upgraded.offsetDistance, 40);
  assert.equal(legacy.offsetDirection, undefined);
});

test('Stack rotation carries the saved dimension placement direction', () => {
  const entity = candidateFromSelections([first], [50, -40], 'driven');
  entity.stackId = 'stack';
  const record = { recordType: 'dimension', entity };
  syncDimensionStackFrames(
    [record],
    { stacks: [{ id: 'stack', frame: { x: 0, y: 0, rotation: 0 } }] },
    { stacks: [{ id: 'stack', frame: { x: 0, y: 0, rotation: Math.PI / 2 } }] },
  );
  assert.ok(Math.abs(record.entity.offsetDirection[0] - 1) < 1e-12);
  assert.ok(Math.abs(record.entity.offsetDirection[1]) < 1e-12);
});

test('point-to-line extension moves only the line origin, regardless of selection order', () => {
  const point = { kind: 'point', recordId: 'p', index: 0, point: [50, 60] };
  for (const selections of [[first, point], [point, first]]) {
    const entity = candidateFromSelections(selections, [200, 30], 'driven');
    const layout = distanceDimensionLayout(entity, 1);
    assert.deepEqual(layout.extensionA.start, [106, 0]);
    assert.deepEqual(layout.extensionB.start, [56, 60]);
  }
});

test('a single line length retains point endpoint gaps', () => {
  const entity = candidateFromSelections([first], [50, -50], 'driven');
  const layout = distanceDimensionLayout(entity, 1);
  assert.deepEqual(layout.extensionA.start, [0, -6]);
  assert.deepEqual(layout.extensionB.start, [100, -6]);
});
