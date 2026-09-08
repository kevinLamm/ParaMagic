import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPanelModel } from '../../packages/paramagic-core/src/modules/CanvasUIControls.js';
import {
  createDimensionLinkManager,
  dimensionParentStates,
  dimensionParentsVisible,
  distanceDimensionLayout,
  measureDrivenDimension,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

test('driven dimensions ignore their cached value and remeasure solved geometry', () => {
  const dimension = {
    type: 'dimension-line',
    dimensionMode: 'driven',
    subtype: 'horizontal',
    start: [0, 0],
    end: [200, 0],
    measureStart: [0, 0],
    measureEnd: [200, 0],
    measuredValue: 100,
    useRenderedMeasurement: true,
  };

  assert.equal(measureDrivenDimension(dimension), 200);
});

test('driven diameter dimensions report twice the current circle radius', () => {
  assert.equal(measureDrivenDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driven',
    radius: 18,
    measuredValue: 12,
  }), 36);
});

test('driven multi-curve dimensions remeasure the current selected features', () => {
  const dimension = {
    type: 'multi-curve-length-dimension',
    dimensionMode: 'driven',
    measuredValue: 25,
    useRenderedMeasurement: true,
  };
  const features = [
    { kind: 'segment', start: [0, 0], end: [30, 0] },
    { kind: 'segment', start: [30, 0], end: [30, 40] },
  ];

  assert.equal(measureDrivenDimension(dimension, features), 70);
});

test('a dimension presentation is hidden when any anchored parent object is hidden', () => {
  const dimension = {
    anchors: {
      start: { recordId: 'visible-parent' },
      end: { recordId: 'hidden-parent' },
    },
  };
  const visibility = new Map([
    ['visible-parent', true],
    ['hidden-parent', false],
  ]);

  assert.equal(
    dimensionParentsVisible(dimension, (recordId) => visibility.get(recordId)),
    false,
  );
  visibility.set('hidden-parent', true);
  assert.equal(
    dimensionParentsVisible(dimension, (recordId) => visibility.get(recordId)),
    true,
  );
});

test('a hidden dimension parent remains solver-enabled while Show Hidden Objects exposes it', () => {
  const dimension = {
    anchors: {
      start: { recordId: 'visible-parent' },
      end: { recordId: 'hidden-parent' },
    },
  };
  const visible = new Map([
    ['visible-parent', true],
    ['hidden-parent', false],
  ]);
  const shown = new Map([
    ['visible-parent', true],
    ['hidden-parent', true],
  ]);

  assert.deepEqual(dimensionParentStates(dimension, {
    isVisible: (recordId) => visible.get(recordId),
    isEnabled: (recordId) => shown.get(recordId),
  }), {
    visible: false,
    enabled: true,
  });

  shown.set('hidden-parent', false);
  assert.equal(dimensionParentStates(dimension, {
    isVisible: (recordId) => visible.get(recordId),
    isEnabled: (recordId) => shown.get(recordId),
  }).enabled, false);
});

test('aligned driven dimension graphics follow current measurement anchors', () => {
  const layout = distanceDimensionLayout({
    type: 'dimension-line',
    dimensionMode: 'driven',
    subtype: 'aligned',
    start: [-100, -50],
    end: [300, -50],
    measureStart: [10, 50],
    measureEnd: [90, 50],
    label: [50, 0],
    anchors: {
      measureStart: { type: 'segment-end', recordId: 'left', index: 0 },
      measureEnd: { type: 'segment-end', recordId: 'right', index: 0 },
    },
  }, 1);

  assert.deepEqual(layout.dimensionStart, [10, 0]);
  assert.deepEqual(layout.dimensionEnd, [90, 0]);
  assert.equal(layout.extensionA.start[0], 10);
  assert.equal(layout.extensionA.end[0], 10);
  assert.equal(layout.extensionB.start[0], 90);
  assert.equal(layout.extensionB.end[0], 90);
});

test('linked aligned dimensions synchronize stale baseline coordinates to measurement anchors', () => {
  const left = {
    id: 'left',
    recordType: 'geometry',
    entity: { type: 'line', start: [0, 100], end: [0, 0] },
  };
  const right = {
    id: 'right',
    recordType: 'geometry',
    entity: { type: 'line', start: [80, 100], end: [80, 0] },
  };
  const node = () => {
    const attributes = new Map();
    return {
      textContent: '',
      style: {},
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      getAttribute(name) {
        return attributes.get(name) || '';
      },
    };
  };
  const dimension = {
    id: 'dimension',
    recordType: 'dimension',
    entity: {
      id: 'dimension',
      type: 'dimension-line',
      dimensionMode: 'driven',
      subtype: 'aligned',
      start: [-100, -50],
      end: [300, -50],
      measureStart: [0, 0],
      measureEnd: [80, 0],
      label: [40, -50],
      text: '80',
      anchors: {
        measureStart: { type: 'segment-end', recordId: left.id, index: 0 },
        measureEnd: { type: 'segment-end', recordId: right.id, index: 0 },
      },
    },
    extensionA: node(),
    extensionB: node(),
    path: node(),
    pathHit: node(),
    arrowA: node(),
    arrowB: node(),
    text: node(),
  };
  const records = [left, right, dimension];
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
    solver: {
      drawingUnit: 'in',
      updateDimensionAnnotation() {},
      dimensions: { setComputedValue() {} },
    },
    applyManagedDimensionText() {},
    updateRecordHandles() {},
    syncScreenInvariantSizing() {},
    getScale: () => 1,
  });

  manager.refreshLinkedDimensions(new Set([left.id, right.id]));

  assert.deepEqual(dimension.entity.start, [0, 0]);
  assert.deepEqual(dimension.entity.end, [80, 0]);
  assert.equal(dimension.path.getAttribute('d'), 'M 0 -50 L 80 -50');
  assert.equal(dimension.extensionA.getAttribute('d'), 'M 0 -6 L 0 -60');
  assert.equal(dimension.extensionB.getAttribute('d'), 'M 80 -6 L 80 -60');

  right.entity.end = [160, 0];
  manager.refreshLinkedDimensions(new Set([right.id]));

  assert.equal(dimension.entity.offsetDistance, 50);
  assert.deepEqual(dimension.entity.offsetDirection, [0, -1]);
  assert.equal(dimension.path.getAttribute('d'), 'M 0 -50 L 160 -50');
});

test('parallel-edge dimensions keep a live perpendicular projection after the edges become nonparallel', () => {
  const reference = {
    id: 'reference-edge',
    recordType: 'geometry',
    entity: { type: 'line', start: [0, 0], end: [10, 0] },
  };
  const measured = {
    id: 'measured-edge',
    recordType: 'geometry',
    entity: { type: 'line', start: [20, 5], end: [30, 5] },
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
    id: 'parallel-edge-dimension',
    recordType: 'dimension',
    entity: {
      id: 'parallel-edge-dimension',
      type: 'dimension-line',
      dimensionMode: 'driven',
      measurementKind: 'parallel-edge-distance',
      subtype: 'aligned',
      start: [20, 0],
      end: [20, 5],
      measureStart: [20, 0],
      measureEnd: [20, 5],
      label: [22, 10],
      text: '5',
      anchors: {
        pointToSegment: {
          point: { type: 'segment-start', recordId: measured.id, index: 0 },
          segment: { kind: 'segment', recordId: reference.id, index: 0 },
          projectionMode: 'line',
        },
      },
    },
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
    solver: {
      drawingUnit: 'in',
      updateDimensionAnnotation() {},
      dimensions: { setComputedValue() {} },
    },
    applyManagedDimensionText() {},
    updateRecordHandles() {},
    syncScreenInvariantSizing() {},
    getScale: () => 1,
  });

  manager.refreshLinkedDimensions(new Set([reference.id, measured.id]));
  assert.deepEqual(dimension.entity.measureStart, [20, 0]);

  reference.entity.end = [10, 10];
  manager.refreshLinkedDimensions(new Set([reference.id]));

  const projection = dimension.entity.measureStart;
  const point = dimension.entity.measureEnd;
  const referenceDirection = [
    reference.entity.end[0] - reference.entity.start[0],
    reference.entity.end[1] - reference.entity.start[1],
  ];
  const measurementDirection = [point[0] - projection[0], point[1] - projection[1]];
  assert.ok(Math.abs(referenceDirection[0] * measurementDirection[0] + referenceDirection[1] * measurementDirection[1]) < 1e-9);
  assert.deepEqual(projection, [12.5, 12.5]);
  assert.ok(Math.abs(dimension.entity.measuredValue - Math.hypot(7.5, -7.5)) < 1e-9);
  assert.equal(dimension.entity.type, 'dimension-line');
  assert.equal(dimension.entity.measurementKind, 'parallel-edge-distance');
});

test('feature lookup resolves promoted geometry handles for constraints and dimensions', () => {
  const line = {
    id: 'promoted-handle-line',
    recordType: 'geometry',
    entity: { type: 'line', start: [0, 0], end: [100, 0] },
    node: {},
    handles: [],
    segmentNodes: [],
  };
  const records = [line];
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
    solver: {
      drawingUnit: 'in',
      updateDimensionAnnotation() {},
      dimensions: { setComputedValue() {} },
    },
    applyManagedDimensionText() {},
    updateRecordHandles() {},
    syncScreenInvariantSizing() {},
    getScale: () => 1,
  });
  const handle = {
    classList: { contains: (name) => name === 'point-handle' },
    dataset: { handleIndex: '0' },
    closest: (selector) => selector === '.canvas-record, .canvas-handle-group'
      ? { dataset: { recordId: line.id } }
      : null,
  };

  assert.deepEqual(
    manager.getFeatureFromEvent({ target: handle, clientX: 0, clientY: 0 }),
    { kind: 'point', recordId: line.id, entityType: 'line', index: 0, point: [0, 0], node: handle },
  );
});

test('a slider-driven solve remeasures proportional segment-point anchors', () => {
  const solver = new SolverController();
  const left = solver.addEntity({
    id: 'left-marker',
    type: 'line',
    start: [0, 100],
    end: [0, 0],
  });
  const right = solver.addEntity({
    id: 'right-marker',
    type: 'line',
    start: [80 * 25.4, 100],
    end: [80 * 25.4, 0],
  });
  assert.ok(solver.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'segment', recordId: left.id, index: 0 }],
  }).constraint);
  assert.ok(solver.addConstraint({
    type: 'Vertical',
    featureRefs: [{ kind: 'segment', recordId: right.id, index: 0 }],
  }).constraint);

  const model = createControlPanelModel({ solver });
  const control = model.add('Horizontal Scrollbar', {
    configurationExpression: 'MinMax(50, 120, 80, 5)',
  });
  const driving = solver.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [...left.end],
    end: [...right.end],
    measureStart: [...left.end],
    measureEnd: [...right.end],
    label: [40 * 25.4, -40],
    text: '',
    anchors: {
      start: { type: 'segment-end', recordId: left.id, index: 0 },
      end: { type: 'segment-end', recordId: right.id, index: 0 },
      measureStart: { type: 'segment-end', recordId: left.id, index: 0 },
      measureEnd: { type: 'segment-end', recordId: right.id, index: 0 },
    },
  });
  const linked = solver.setDimension(driving.entity.dimensionId, control.parameterName);
  assert.ok(['converged', 'unchanged'].includes(linked.status), linked.message);
  const driven = solver.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driven',
    subtype: 'aligned',
    start: [...left.end],
    end: [...right.end],
    measureStart: [...left.end],
    measureEnd: [...right.end],
    label: [40 * 25.4, -80],
    text: '',
    anchors: {
      measureStart: {
        type: 'segment-point',
        recordId: left.id,
        index: 0,
        ratio: 1,
      },
      measureEnd: { type: 'segment-end', recordId: right.id, index: 0 },
    },
  });

  model.setValue(control.id, 100);

  const measured = solver.dimensions.get(driven.entity.dimensionId);
  assert.ok(Math.abs(measured.value - (100 * 25.4)) < 1e-3);
  assert.equal(solver.getDimensionText(driven.entity.dimensionId, 'value'), '100"');
});
