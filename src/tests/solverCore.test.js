import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DimensionRepository,
  computeJacobian,
  multiply,
  multiplyMatrixVector,
  solveLevenbergMarquardt,
  solveLinearSystem,
  transpose,
} from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { SketchModel, Variable, createGeometryBinding } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { CANVAS_ORIGIN_RECORD_ID } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';
import { evaluateFillet, regularFilletConstraints } from '../../packages/paramagic-core/src/modules/FilletSystem.js';

const near = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);

function maximumNumericDelta(first, second) {
  if (typeof first === 'number' || typeof second === 'number') {
    return typeof first === 'number' && typeof second === 'number' ? Math.abs(first - second) : Infinity;
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return Infinity;
    return first.reduce((largest, value, index) => Math.max(largest, maximumNumericDelta(value, second[index])), 0);
  }
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return 0;
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return [...keys].reduce((largest, key) => Math.max(largest, maximumNumericDelta(first[key], second[key])), 0);
}

test('a numerical solve samples parameters once instead of once per Jacobian column', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'sample-once-line', type: 'line', start: [0, 0], end: [10, 3] });
  model.addConstraint({
    id: 'sample-once-horizontal',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'sample-once-line', index: 0 }],
  });
  const dimensions = new DimensionRepository();
  const evaluateDirty = dimensions.evaluateDirty.bind(dimensions);
  let evaluationCount = 0;
  dimensions.evaluateDirty = (options) => {
    evaluationCount += 1;
    return evaluateDirty(options);
  };

  const result = solveLevenbergMarquardt({
    model,
    registry: new ConstraintRegistry(),
    dimensions,
  });

  assert.equal(result.status, 'converged');
  assert.equal(evaluationCount, 1);
});

function mixedJacobianFixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 3] });
  model.addEntity({ id: 'line-b', type: 'line', start: [2, -4], end: [7, 8] });
  model.addConstraint({
    id: 'horizontal-a',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'line-a', index: 0 }],
  });
  model.addConstraint({
    id: 'vertical-b',
    type: 'Vertical',
    featureRefs: [{ kind: 'segment', recordId: 'line-b', index: 0 }],
  });
  model.addConstraint({
    id: 'right-angle',
    type: 'Angle',
    featureRefs: [
      { kind: 'segment', recordId: 'line-a', index: 0 },
      { kind: 'segment', recordId: 'line-b', index: 0 },
    ],
    value: 90,
  });
  return model;
}

test('block Jacobian mode matches dense convergence and reports mixed usage', () => {
  const dense = solveLevenbergMarquardt({
    model: mixedJacobianFixture(),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
  });
  const blocks = solveLevenbergMarquardt({
    model: mixedJacobianFixture(),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
  });

  assert.equal(dense.status, 'converged');
  assert.equal(blocks.status, 'converged');
  assert.ok(blocks.finalError <= 1e-8);
  assert.equal(dense.jacobianStats.mode, 'dense');
  assert.deepEqual(blocks.jacobianStats, {
    requestedMode: 'blocks',
    mode: 'blocks',
    totalBlocks: 3,
    analyticalBlocks: 2,
    fallbackBlocks: 1,
    residualRows: 3,
  });
});

test('matrix-free block solve matches dense convergence when forced below its automatic threshold', () => {
  const denseModel = mixedJacobianFixture();
  const matrixFreeModel = mixedJacobianFixture();
  const dense = solveLevenbergMarquardt({
    model: denseModel,
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
  });
  const matrixFree = solveLevenbergMarquardt({
    model: matrixFreeModel,
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
  });

  assert.equal(dense.status, 'converged');
  assert.equal(matrixFree.status, 'converged', matrixFree.message);
  assert.ok(matrixFree.finalError <= 1e-8);
  assert.equal(matrixFree.jacobianStats.mode, 'matrix-free');
  assert.equal(matrixFree.jacobianStats.linearConverged, true);
  assert.ok(matrixFree.jacobianStats.derivativeEntries > 0);
  assert.ok(maximumNumericDelta(
    denseModel.allVariables().map(({ value }) => value),
    matrixFreeModel.allVariables().map(({ value }) => value),
  ) < 1e-6);
});

function axisConstraintFixture(lineCount) {
  const model = new SketchModel();
  for (let index = 0; index < lineCount; index += 1) {
    model.addEntity({
      id: `adaptive-line-${index}`,
      type: 'line',
      start: [index * 20, index],
      end: [index * 20 + 10, index + 3],
    });
    model.addConstraint({
      id: `adaptive-horizontal-${index}`,
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: `adaptive-line-${index}`, index: 0 }],
    });
  }
  return model;
}

test('interactive block solves switch to matrix-free work at the lower drag threshold', () => {
  const interactive = solveLevenbergMarquardt({
    model: axisConstraintFixture(12),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    solveMode: 'interactive',
  });
  const final = solveLevenbergMarquardt({
    model: axisConstraintFixture(12),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    solveMode: 'final',
  });

  assert.equal(interactive.status, 'converged', interactive.message);
  assert.equal(interactive.jacobianStats.mode, 'matrix-free');
  assert.equal(interactive.jacobianStats.matrixFreeThreshold, 48);
  assert.equal(interactive.jacobianStats.matrixFreeThresholdSource, 'interactive');
  assert.equal(final.status, 'converged', final.message);
  assert.equal(final.jacobianStats.mode, 'blocks');
});

test('large matrix-free components use entity-block preconditioning', () => {
  const result = solveLevenbergMarquardt({
    model: axisConstraintFixture(25),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
  });

  assert.equal(result.status, 'converged', result.message);
  assert.equal(result.jacobianStats.mode, 'matrix-free');
  assert.equal(result.jacobianStats.linearPreconditioner, 'entity-block');
  assert.equal(result.jacobianStats.largestPreconditionerBlock, 4);
});

function fixedConstraint(recordId, kind) {
  return { id: `fixed-${recordId}`, type: 'Fixed', featureRefs: [{ kind, recordId }] };
}

function pointOnCircleFixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'circle', type: 'circle', center: [0, 0], radius: 5 });
  model.addEntity({ id: 'point', type: 'point', point: [3, 9] });
  model.addConstraint(fixedConstraint('circle', 'circle'));
  model.addConstraint({
    id: 'point-on-circle',
    type: 'Point-on Circle',
    featureRefs: [{ kind: 'point', recordId: 'point', index: 0 }, { kind: 'circle', recordId: 'circle' }],
  });
  return model;
}

function pointOnArcFixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'arc', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'point', type: 'point', point: [1, 9] });
  model.addConstraint(fixedConstraint('arc', 'arc'));
  model.addConstraint({
    id: 'point-on-arc',
    type: 'Point-on Arc',
    featureRefs: [{ kind: 'point', recordId: 'point', index: 0 }, { kind: 'arc', recordId: 'arc' }],
  });
  return model;
}

function tangentFixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'circle', type: 'circle', center: [0, 0], radius: 5 });
  model.addEntity({ id: 'line', type: 'line', start: [-8, 9], end: [8, 7] });
  model.addConstraint(fixedConstraint('circle', 'circle'));
  model.addConstraint({
    id: 'line-circle-tangent',
    type: 'Tangent',
    featureRefs: [{ kind: 'segment', recordId: 'line' }, { kind: 'circle', recordId: 'circle' }],
  });
  return model;
}

function pointOnFilletFixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'fillet-horizontal', type: 'line', start: [0, 0], end: [100, 0] });
  model.addEntity({ id: 'fillet-vertical', type: 'line', start: [0, 0], end: [0, 100] });
  model.addEntity({ id: 'fillet-point', type: 'point', point: [1, 1] });
  model.setDerivedEntity({
    id: 'derived-fillet',
    type: 'fillet',
    sourceA: { recordId: 'fillet-horizontal', index: 0 },
    sourceB: { recordId: 'fillet-vertical', index: 0 },
    radius: 10,
  });
  model.addConstraint(fixedConstraint('fillet-horizontal', 'segment'));
  model.addConstraint(fixedConstraint('fillet-vertical', 'segment'));
  model.addConstraint({
    id: 'point-on-fillet',
    type: 'Point-on Fillet',
    featureRefs: [
      { kind: 'point', recordId: 'fillet-point', index: 0 },
      { kind: 'arc', recordId: 'derived-fillet' },
    ],
  });
  return model;
}

test('point-on and tangent fixtures retain dense/block convergence parity', () => {
  for (const fixture of [pointOnCircleFixture, pointOnArcFixture, pointOnFilletFixture, tangentFixture]) {
    const dense = solveLevenbergMarquardt({
      model: fixture(),
      registry: new ConstraintRegistry(),
      dimensions: new DimensionRepository(),
    });
    const blocks = solveLevenbergMarquardt({
      model: fixture(),
      registry: new ConstraintRegistry(),
      dimensions: new DimensionRepository(),
      jacobianMode: 'blocks',
    });
    assert.equal(dense.status, 'converged', `${fixture.name}: ${dense.message}`);
    assert.equal(blocks.status, 'converged', `${fixture.name}: ${blocks.message}`);
    assert.ok(dense.finalError <= 1e-8);
    assert.ok(blocks.finalError <= 1e-8);
    assert.ok(blocks.jacobianStats.analyticalBlocks >= 1);
  }
});

test('serialized mixed drawing retains dense/block geometry parity after an edit', () => {
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const segment = (recordId) => ({ kind: 'segment', recordId, index: 0 });
  const snapshot = {
    entities: [
      { id: 'bottom', type: 'line', start: [0, 0], end: [10, 0] },
      { id: 'right', type: 'line', start: [10, 0], end: [10, 10] },
      { id: 'top', type: 'line', start: [10, 10], end: [0, 10] },
      { id: 'left', type: 'line', start: [0, 10], end: [0, 0] },
      { id: 'follower', type: 'line', start: [2, 0], end: [8, 0] },
      { id: 'circle', type: 'circle', center: [5, 5], radius: 5 },
    ],
    constraints: [
      { id: 'fixed-origin', type: 'Fixed', featureRefs: [point('bottom', 0)] },
      ...['bottom', 'top', 'follower'].map((recordId) => ({ id: `horizontal-${recordId}`, type: 'Horizontal', featureRefs: [segment(recordId)] })),
      ...['left', 'right'].map((recordId) => ({ id: `vertical-${recordId}`, type: 'Vertical', featureRefs: [segment(recordId)] })),
      { id: 'corner-1', type: 'Coincident', featureRefs: [point('bottom', 2), point('right', 0)] },
      { id: 'corner-2', type: 'Coincident', featureRefs: [point('right', 2), point('top', 0)] },
      { id: 'corner-3', type: 'Coincident', featureRefs: [point('top', 2), point('left', 0)] },
      { id: 'corner-4', type: 'Coincident', featureRefs: [point('left', 2), point('bottom', 0)] },
      { id: 'same-baseline', type: 'Collinear', featureRefs: [segment('bottom'), segment('follower')] },
      { id: 'circle-tangent', type: 'Tangent', featureRefs: [segment('bottom'), { kind: 'circle', recordId: 'circle' }] },
      {
        id: 'width',
        type: 'Horizontal Distance',
        anchors: { start: { type: 'segment-start', recordId: 'bottom' }, end: { type: 'segment-end', recordId: 'bottom' } },
        featureRefs: [],
        value: 10,
      },
      {
        id: 'height',
        type: 'Vertical Distance',
        anchors: { start: { type: 'segment-start', recordId: 'right' }, end: { type: 'segment-end', recordId: 'right' } },
        featureRefs: [],
        value: 10,
      },
    ],
  };
  const dense = createSolverController({ jacobianMode: 'dense' });
  const blocks = createSolverController({ jacobianMode: 'blocks' });
  assert.equal(dense.loadSketch(snapshot).status, 'unchanged');
  assert.equal(blocks.loadSketch(snapshot).status, 'unchanged');
  dense.model.variableById('top:end.y').value += 2;
  blocks.model.variableById('top:end.y').value += 2;

  const denseResult = dense.solve({ fullSolve: true });
  const blockResult = blocks.solve({ fullSolve: true });

  assert.equal(denseResult.status, 'converged', denseResult.message);
  assert.equal(blockResult.status, 'converged', blockResult.message);
  assert.equal(blockResult.jacobianStats.mode, 'blocks');
  assert.ok(blockResult.jacobianStats.analyticalBlocks > blockResult.jacobianStats.fallbackBlocks);
  assert.ok(maximumNumericDelta(dense.getGeometrySnapshot(), blocks.getGeometrySnapshot()) < 1e-7);
});

test('serialized arc-heavy drawing retains dense/block parity across derived fillet components', () => {
  const entities = [];
  const derivedEntities = [];
  const constraints = [];
  for (let index = 0; index < 12; index += 1) {
    const offsetX = (index % 4) * 140;
    const offsetY = Math.floor(index / 4) * 140;
    const translate = ([x, y]) => [x + offsetX, y + offsetY];
    const first = {
      id: `arc-heavy-${index}-a`,
      type: 'arc',
      start: translate([0, 0]),
      arcPoint: translate([14.64466094067263, 35.35533905932737]),
      end: translate([50, 50]),
      center: translate([50, 0]),
      radius: 50,
      ccw: false,
    };
    const second = {
      id: `arc-heavy-${index}-b`,
      type: 'arc',
      start: translate([0, 0]),
      arcPoint: translate([35.35533905932738, 14.64466094067262]),
      end: translate([50, 50]),
      center: translate([0, 50]),
      radius: 50,
      ccw: true,
    };
    const fillet = {
      id: `arc-heavy-${index}-fillet`,
      type: 'fillet',
      sourceA: { recordId: first.id, index: 0 },
      sourceB: { recordId: second.id, index: 0 },
      radius: 10,
    };
    const evaluated = evaluateFillet(fillet, new Map([[first.id, first], [second.id, second]]));
    assert.equal(evaluated.valid, true, evaluated.error);
    const marker = { id: `arc-heavy-${index}-marker`, type: 'point', point: evaluated.arc.arcPoint };
    entities.push(first, second, marker);
    derivedEntities.push(fillet);
    constraints.push(
      fixedConstraint(first.id, 'arc'),
      fixedConstraint(second.id, 'arc'),
      {
        id: `arc-heavy-${index}-point-on-fillet`,
        type: 'Point-on Fillet',
        featureRefs: [
          { kind: 'point', recordId: marker.id, index: 0 },
          { kind: 'arc', recordId: fillet.id },
        ],
      },
      {
        id: `arc-heavy-${index}-marker-x`,
        type: 'Horizontal Distance',
        featureRefs: [
          { kind: 'point', recordId: CANVAS_ORIGIN_RECORD_ID, index: 0 },
          { kind: 'point', recordId: marker.id, index: 0 },
        ],
        value: marker.point[0],
      },
    );
  }
  const snapshot = JSON.parse(JSON.stringify({ entities, derivedEntities, constraints }));
  const dense = createSolverController({ jacobianMode: 'dense' });
  const blocks = createSolverController({ jacobianMode: 'blocks' });
  assert.equal(dense.loadSketch(snapshot).status, 'unchanged');
  assert.equal(blocks.loadSketch(snapshot).status, 'unchanged');
  for (let index = 0; index < 12; index += 1) {
    dense.model.variableById(`arc-heavy-${index}-marker:point.x`).value += 2;
    blocks.model.variableById(`arc-heavy-${index}-marker:point.x`).value += 2;
  }

  const denseResult = dense.solve({ fullSolve: true });
  const blockResult = blocks.solve({ fullSolve: true });

  assert.equal(denseResult.status, 'converged', denseResult.message);
  assert.equal(blockResult.status, 'converged', blockResult.message);
  assert.equal(denseResult.iterations, blockResult.iterations);
  assert.equal(blockResult.jacobianStats.mode, 'blocks');
  assert.ok(blockResult.jacobianStats.analyticalBlocks > blockResult.jacobianStats.fallbackBlocks);
  const geometryDelta = maximumNumericDelta(dense.getGeometrySnapshot(), blocks.getGeometrySnapshot());
  assert.ok(geometryDelta < 1e-7, `Dense/block arc-heavy geometry delta was ${geometryDelta}.`);
});

test('the built-in canvas origin resolves as an immutable solver point', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'point-a', type: 'point', point: [18, -11] });

  assert.deepEqual(controller.model.resolvePoint({
    kind: 'point',
    recordId: CANVAS_ORIGIN_RECORD_ID,
    index: 0,
  }), [0, 0]);
  assert.deepEqual(controller.variableIdsForFeature({
    kind: 'point',
    recordId: CANVAS_ORIGIN_RECORD_ID,
    index: 0,
  }), []);

  const outcome = controller.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: CANVAS_ORIGIN_RECORD_ID, index: 0 },
      { kind: 'point', recordId: 'point-a', index: 0 },
    ],
  });
  assert.ok(outcome.constraint);
  const point = outcome.snapshot.find((entity) => entity.id === 'point-a');
  near(point.point[0], 0);
  near(point.point[1], 0);

  const saved = controller.getSketchSnapshot();
  assert.equal(saved.entities.some((entity) => entity.id === CANVAS_ORIGIN_RECORD_ID), false);
  const restored = createSolverController();
  assert.doesNotThrow(() => restored.loadSketch(saved));
  assert.equal(restored.constraints()[0].featureRefs[0].recordId, CANVAS_ORIGIN_RECORD_ID);
});

test('table solver bindings preserve rectangular corners when constrained', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'table-a', type: 'table', x: 18, y: -11, width: 120, height: 70 });

  const outcome = controller.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'table-a', index: 0 },
      { kind: 'point', recordId: CANVAS_ORIGIN_RECORD_ID, index: 0 },
    ],
  });
  assert.ok(outcome.constraint);
  const table = outcome.snapshot.find((entity) => entity.id === 'table-a');
  near(table.x, 0);
  near(table.y, 0);
  near(table.width, 120);
  near(table.height, 70);
  assert.deepEqual(table.type, 'table');
});

test('table drag updates survive the solver drag release snapshot', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'table-drag', type: 'table', x: 10, y: 20, width: 120, height: 70 });
  controller.beginDrag(controller.variableIdsForEntity('table-drag'));

  const preview = controller.updateEntities([{
    id: 'table-drag',
    type: 'table',
    x: 100,
    y: 140,
    width: 120,
    height: 70,
  }]);
  assert.deepEqual(
    preview.snapshot.find((entity) => entity.id === 'table-drag'),
    { id: 'table-drag', type: 'table', x: 100, y: 140, width: 120, height: 70 },
  );

  controller.endDrag();
  assert.deepEqual(
    controller.getGeometrySnapshot().find((entity) => entity.id === 'table-drag'),
    { id: 'table-drag', type: 'table', x: 100, y: 140, width: 120, height: 70 },
  );
});

test('unsatisfiable interactive geometry previews restore the last valid component', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'constrained-drag-point', type: 'point', point: [0, 0] });
  controller.addEntity({ id: 'constrained-anchor', type: 'line', start: [0, 0], end: [10, 0] });
  assert.ok(controller.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'constrained-drag-point', index: 0 },
      { kind: 'point', recordId: 'constrained-anchor', index: 0 },
    ],
  }).constraint);
  assert.ok(controller.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: CANVAS_ORIGIN_RECORD_ID, index: 0 },
      { kind: 'point', recordId: 'constrained-anchor', index: 0 },
    ],
  }).constraint);

  controller.beginDrag(controller.variableIdsForEntity('constrained-drag-point'));
  const preview = controller.updateEntities([{
    id: 'constrained-drag-point',
    type: 'point',
    point: [100, 100],
  }], {
    solveOptions: { solveMode: 'interactive', timeBudgetMs: 10, maxIterations: 24 },
  });

  assert.equal(preview.result.status, 'preview');
  assert.equal(preview.result.restoredInteractivePreview, true);
  assert.deepEqual(
    preview.snapshot.find((entity) => entity.id === 'constrained-drag-point'),
    { id: 'constrained-drag-point', type: 'point', point: [0, 0] },
  );
});

function largeDimensionContinuationFixture() {
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const segment = (recordId) => ({ kind: 'segment', recordId, index: 0 });
  const coincident = (first, second) => ({ type: 'Coincident', featureRefs: [first, second] });
  const oneSegment = (type, recordId) => ({ type, featureRefs: [segment(recordId)] });
  const dimension = (name, expression) => ({
    id: name,
    name,
    expression,
    value: Number(expression) * 25.4,
    kind: 'dimension',
    driving: true,
    computed: false,
    enabled: true,
    unit: 'in',
  });
  const xLeft = -4594.707510307654;
  const xRight = 7526.766500563685;
  const innerLeft = -4442.307510307651;
  const innerRight = 7374.366500563682;
  const topY = -996.3405007939434;
  const bottomY = -5411.012900793949;
  const baseY = -5455.462900793933;
  const constraints = [
    oneSegment('Horizontal', 'rectangle-bottom'),
    coincident(point('right-side', 0), point('rectangle-bottom', 2)),
    oneSegment('Vertical', 'right-side'),
    coincident(point('top', 0), point('right-side', 2)),
    oneSegment('Horizontal', 'top'),
    coincident(point('left-side', 0), point('top', 2)),
    coincident(point('left-side', 2), point('rectangle-bottom', 0)),
    oneSegment('Vertical', 'left-side'),
    oneSegment('Horizontal', 'moving-bottom'),
    oneSegment('Horizontal', 'arc-base'),
    coincident(point('left-arc', 0), point('arc-base', 0)),
    coincident(point('left-arc', 2), point('moving-bottom', 0)),
    {
      type: 'Tangent',
      featureRefs: [{ kind: 'arc', recordId: 'left-arc' }, segment('arc-base')],
      tangentPoint: point('left-arc', 0),
    },
    {
      type: 'Horizontal Distance',
      anchors: { start: { type: 'point', recordId: 'arc-base', index: 0 }, end: { type: 'point', recordId: 'left-arc', index: 2 } },
      featureRefs: [],
      dimensionRef: 'd5',
      orientation: -1,
    },
    {
      type: 'Vertical Distance',
      anchors: { start: { type: 'segment-start', recordId: 'arc-base', index: 0 }, end: { type: 'segment-start', recordId: 'moving-bottom', index: 0 } },
      featureRefs: [],
      dimensionRef: 'd6',
      orientation: 1,
    },
    coincident(point('left-side', 2), point('left-arc', 2)),
    coincident(point('right-arc', 0), point('arc-base', 2)),
    coincident(point('right-arc', 2), point('moving-bottom', 2)),
    {
      type: 'Tangent',
      featureRefs: [{ kind: 'arc', recordId: 'right-arc' }, segment('arc-base')],
      tangentPoint: point('right-arc', 0),
    },
    {
      type: 'Horizontal Distance',
      anchors: { start: { type: 'point', recordId: 'right-arc', index: 0 }, end: { type: 'point', recordId: 'right-arc', index: 2 } },
      featureRefs: [],
      dimensionRef: 'd7',
      orientation: 1,
    },
    coincident(point('right-arc', 2), point('rectangle-bottom', 2)),
    {
      type: 'Vertical Distance',
      anchors: { start: { type: 'segment-start', recordId: 'moving-bottom', index: 0 }, end: { type: 'segment-end', recordId: 'top', index: 0 } },
      featureRefs: [],
      dimensionRef: 'd9',
      orientation: 1,
    },
    oneSegment('Fixed', 'top'),
  ].map((constraint, index) => ({ id: `continuation-${index}`, enabled: true, ...constraint }));
  return {
    drawingUnit: 'in',
    entities: [
      { id: 'rectangle-bottom', type: 'line', start: [xLeft, bottomY], end: [xRight, bottomY] },
      { id: 'right-side', type: 'line', start: [xRight, bottomY], end: [xRight, topY] },
      { id: 'top', type: 'line', start: [xRight, topY], end: [xLeft, topY] },
      { id: 'left-side', type: 'line', start: [xLeft, topY], end: [xLeft, bottomY] },
      { id: 'moving-bottom', type: 'line', start: [xLeft, bottomY], end: [xRight, bottomY] },
      { id: 'arc-base', type: 'line', start: [innerLeft, baseY], end: [innerRight, baseY] },
      {
        id: 'left-arc',
        type: 'arc',
        start: [innerLeft, baseY],
        arcPoint: [-4552.469940947467, -5433.182527033479],
        end: [xLeft, bottomY],
        center: [-4442.307510083093, -5171.980757166828],
        radius: 283.48214362710553,
        ccw: false,
      },
      {
        id: 'right-arc',
        type: 'arc',
        start: [innerRight, baseY],
        arcPoint: [7452.982202174324, -5444.3439286500015],
        end: [xRight, bottomY],
        center: [7374.366500339061, -5171.980757166643],
        radius: 283.4821436272912,
        ccw: true,
      },
    ],
    constraints,
    parameters: [
      dimension('d5', '6'),
      dimension('d6', '1.75'),
      dimension('d7', '6'),
      dimension('d9', '173.806'),
    ],
  };
}

test('Gaussian elimination uses partial pivoting', () => {
  const result = solveLinearSystem([[0, 2], [1, 1]], [4, 3]);
  near(result[0], 1);
  near(result[1], 2);
});

test('matrix helpers and numerical Jacobian match known values', () => {
  assert.deepEqual(transpose([[1, 2], [3, 4]]), [[1, 3], [2, 4]]);
  assert.deepEqual(multiply([[1, 2]], [[3], [4]]), [[11]]);
  assert.deepEqual(multiplyMatrixVector([[1, 2], [3, 4]], [2, 1]), [4, 10]);
  const x = new Variable({ id: 'x', value: 3 });
  const jacobian = computeJacobian([x], () => [x.value ** 2]);
  near(jacobian[0][0], 6, 1e-4);
});

test('variables leave the active set when fixed or temporarily locked', () => {
  const variable = new Variable({ value: 1 });
  assert.equal(variable.active, true);
  variable.locked = true;
  assert.equal(variable.active, false);
  variable.locked = false;
  variable.fixed = true;
  assert.equal(variable.active, false);
});

test('linear solver rejects singular and near-zero pivots', () => {
  assert.throws(() => solveLinearSystem([[1, 2], [2, 4]], [1, 2]), /singular/i);
  assert.throws(() => solveLinearSystem([[1e-16]], [1]), /singular/i);
});

test('LM rejects non-improving steps, reaches its limit, and rolls back', () => {
  const variable = new Variable({ id: 'x', value: 7, owner: 'fixture' });
  const model = { allVariables: () => [variable], activeVariables: () => [variable] };
  const registry = { evaluate: () => ({ values: [1], equations: [{ constraintId: 'constant-error' }] }) };
  const result = solveLevenbergMarquardt({ model, registry, dimensions: null, maxIterations: 3 });
  assert.equal(result.status, 'max-iterations');
  assert.equal(result.rejectedSteps, 3);
  assert.equal(variable.value, 7);
});

test('LM stops a stalled final solve before exhausting a large iteration budget', () => {
  const variable = new Variable({ id: 'stalled-x', value: 7, owner: 'stalled-fixture' });
  const model = { allVariables: () => [variable], activeVariables: () => [variable] };
  const registry = { evaluate: () => ({ values: [1], equations: [{ constraintId: 'constant-error' }] }) };

  const result = solveLevenbergMarquardt({ model, registry, dimensions: null, maxIterations: 2000 });

  assert.equal(result.status, 'max-iterations');
  assert.equal(result.terminationReason, 'stagnation');
  assert.ok(result.iterations < 100);
  assert.equal(variable.value, 7);
});

test('interactive LM retains its best improving state when its iteration budget expires', () => {
  const variable = new Variable({ id: 'preview-x', value: 10, owner: 'preview-fixture' });
  const model = { allVariables: () => [variable], activeVariables: () => [variable] };
  const registry = { evaluate: () => ({ values: [variable.value - 2], equations: [] }) };
  const result = solveLevenbergMarquardt({
    model,
    registry,
    dimensions: null,
    solveMode: 'interactive',
    maxIterations: 1,
    tolerance: 1e-20,
  });
  assert.equal(result.status, 'preview');
  assert.equal(result.solveMode, 'interactive');
  assert.equal(result.cancellationReason, 'iteration-budget');
  assert.ok(result.finalError < result.initialError);
  assert.notEqual(variable.value, 10);
});

test('LM cooperatively cancels during numerical work and restores strict final solves', () => {
  const variable = new Variable({ id: 'cancel-x', value: 10, owner: 'cancel-fixture' });
  const model = { allVariables: () => [variable], activeVariables: () => [variable] };
  const registry = { evaluate: () => ({ values: [variable.value - 2], equations: [] }) };
  let checks = 0;
  const preview = solveLevenbergMarquardt({
    model,
    registry,
    dimensions: null,
    solveMode: 'interactive',
    shouldCancel: () => (++checks >= 2 ? 'superseded' : null),
  });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.cancellationReason, 'superseded');

  variable.value = 10;
  const final = solveLevenbergMarquardt({
    model,
    registry,
    dimensions: null,
    shouldCancel: () => 'shutdown',
  });
  assert.equal(final.status, 'cancelled');
  assert.equal(final.cancellationReason, 'shutdown');
  assert.equal(variable.value, 10);
});

test('dimension repository evaluates units and dependency expressions', () => {
  const dimensions = new DimensionRepository();
  dimensions.set({ id: 'width', name: 'width', expression: '40 mm' });
  dimensions.set({ id: 'pitch', name: 'pitch', expression: 'width / 2 + 1 cm' });
  assert.equal(dimensions.value('pitch'), 30);
  assert.throws(() => dimensions.set({ id: 'width', name: 'width', expression: 'pitch' }), /cycle/i);
});

test('geometry bindings round-trip current primitives with stable IDs', () => {
  const composite = { id: 'rectangle-a', kind: 'rectangle', closed: true, index: 0, count: 4 };
  const appearance = { fillColor: '#123456', strokeThickness: 2.5 };
  const line = createGeometryBinding({ id: 'line-a', type: 'line', start: [1, 2], end: [3, 4], composite, appearance }).toEntity();
  assert.deepEqual(line, { id: 'line-a', type: 'line', start: [1, 2], end: [3, 4], composite, appearance });
  const text = createGeometryBinding({ id: 'text-a', type: 'text', x: 7, y: 9, text: 'Anchor', fontName: 'Arial', fontSize: 28 }).toEntity();
  assert.deepEqual(text, { id: 'text-a', type: 'text', x: 7, y: 9, text: 'Anchor', fontName: 'Arial', fontSize: 28 });
  const arc = createGeometryBinding({ id: 'arc-a', type: 'arc', start: [10, 0], arcPoint: [0, 10], end: [-10, 0] }).toEntity();
  assert.equal(arc.id, 'arc-a');
  near(arc.arcPoint[0], 0);
  near(arc.arcPoint[1], 10);
  const circle = createGeometryBinding({ id: 'circle-a', type: 'circle', center: [4, 5], radius: 6 }).toEntity();
  assert.deepEqual(circle, { id: 'circle-a', type: 'circle', center: [4, 5], radius: 6 });
  for (const type of ['polygon', 'polyline', 'curve']) {
    const points = [[0, 0], [2, 3], [5, 1]];
    assert.deepEqual(createGeometryBinding({ id: `${type}-a`, type, points }).toEntity(), { id: `${type}-a`, type, points });
  }
});

test('geometry bindings preserve explicit stack ownership without adding it to legacy entities', () => {
  const stacked = createGeometryBinding({ id: 'stacked', type: 'line', start: [0, 0], end: [5, 0], stackId: 'stack-a' });
  const legacy = createGeometryBinding({ id: 'legacy', type: 'line', start: [0, 0], end: [5, 0] });
  assert.equal(stacked.toEntity().stackId, 'stack-a');
  assert.equal(Object.hasOwn(legacy.toEntity(), 'stackId'), false);
});

test('arc bindings preserve large-radius circle metadata through shallow arc points', () => {
  const arc = createGeometryBinding({
    id: 'large-arc',
    type: 'arc',
    start: [-50, 0],
    arcPoint: [0, -1e-12],
    end: [50, 0],
    center: [0, 1_000_000_000_000_000],
    radius: 1_000_000_000_000_000,
  }).toEntity();

  assert.equal(arc.id, 'large-arc');
  assert.deepEqual(arc.center, [0, 1_000_000_000_000_000]);
  near(arc.radius, 1_000_000_000_000_000, 1);
});

test('arc bindings reuse metrics until a solver variable changes', () => {
  const binding = createGeometryBinding({
    id: 'cached-arc',
    type: 'arc',
    start: [5, 0],
    arcPoint: [5 * Math.SQRT1_2, 5 * Math.SQRT1_2],
    end: [0, 5],
  });
  const first = binding.arcMetrics();
  const reused = binding.arcMetrics();
  assert.strictEqual(reused, first);
  assert.ok(Math.abs(first.length - Math.PI * 2.5) < 1e-8);

  binding.variables.get('end.y').value += 1;
  const updated = binding.arcMetrics();
  assert.notStrictEqual(updated, first);
  assert.notEqual(updated.length, first.length);
});

test('entity appearances persist through sketch snapshots and exclude construction geometry', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'styled-line', type: 'line', start: [0, 0], end: [20, 0] });
  const arc = controller.addEntity({ id: 'styled-arc', type: 'arc', start: [10, 0], arcPoint: [0, 10], end: [-10, 0] });
  const construction = controller.addEntity({ id: 'construction-line', type: 'line', start: [0, 10], end: [20, 10], construction: true });
  controller.updateEntityAppearances([
    { id: line.id, appearance: { fillColor: '#abcdef', strokeThickness: 3, zIndex: 7 } },
    { id: arc.id, appearance: { fillColor: '#fedcba', strokeThickness: 2.5 } },
    { id: construction.id, appearance: { fillColor: '#111111', strokeThickness: 8 } },
  ]);
  const snapshot = controller.getSketchSnapshot();
  assert.deepEqual(snapshot.entities.find(({ id }) => id === line.id).appearance, { fillColor: '#abcdef', strokeThickness: 3, zIndex: 7 });
  assert.deepEqual(snapshot.entities.find(({ id }) => id === arc.id).appearance, { fillColor: '#fedcba', strokeThickness: 2.5 });
  assert.equal(snapshot.entities.find(({ id }) => id === construction.id).appearance, undefined);
  const restored = createSolverController();
  restored.loadSketch(snapshot);
  assert.deepEqual(restored.getSketchSnapshot().entities.find(({ id }) => id === line.id).appearance, { fillColor: '#abcdef', strokeThickness: 3, zIndex: 7 });
  restored.updateEntityConstruction([line.id], true);
  assert.equal(restored.getEntity(line.id).construction, true);
  assert.deepEqual(restored.getEntity(line.id).appearance, { fillColor: '#abcdef', strokeThickness: 3, zIndex: 7 });
  restored.updateEntityConstruction([line.id], false);
  assert.equal(restored.getEntity(line.id).construction, undefined);
});

test('edited entity stroke colors persist through solver appearance updates', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'colored-line', type: 'line', start: [0, 0], end: [20, 0] });

  controller.updateEntityAppearances([{ id: line.id, appearance: { strokeColor: '#12abef' } }]);

  assert.equal(controller.getEntity(line.id).appearance.strokeColor, '#12abef');
  assert.equal(controller.getSketchSnapshot().entities.find(({ id }) => id === line.id).appearance.strokeColor, '#12abef');
});

test('geometry class ownership and property overrides round-trip through the solver model', () => {
  const controller = createSolverController();
  const line = controller.addEntity({
    id: 'classified-line',
    type: 'line',
    start: [0, 0],
    end: [20, 0],
    classId: 'class-cut',
    classPropertyOverrides: [],
  });
  assert.equal(line.classId, 'class-cut');
  assert.deepEqual(line.classPropertyOverrides, []);

  controller.updateEntity({
    ...line,
    appearance: { strokeExpression: '#123456' },
    classPropertyOverrides: ['stroke'],
  });
  const snapshot = controller.getSketchSnapshot();
  const stored = snapshot.entities.find(({ id }) => id === line.id);
  assert.equal(stored.classId, 'class-cut');
  assert.deepEqual(stored.classPropertyOverrides, ['stroke']);

  const restored = createSolverController();
  restored.loadSketch(snapshot);
  assert.equal(restored.getEntity(line.id).classId, 'class-cut');
  assert.deepEqual(restored.getEntity(line.id).classPropertyOverrides, ['stroke']);
});

test('LM solver satisfies a horizontal constraint', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [100, 25] });
  const added = controller.addConstraint({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  assert.ok(['converged', 'unchanged'].includes(added.result.status));
  assert.ok(added.result.timings.totalMs >= 0);
  const solved = controller.getEntity(line.id);
  near(solved.start[1], solved.end[1]);
});

test('Length locks a line length while allowing its angle and position to change', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'length-line', type: 'line', start: [0, 0], end: [10, 0] });
  const added = controller.addConstraint({ type: 'Length', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  assert.ok(added.constraint, added.result.message);
  assert.equal(added.constraint.value, 10);

  const edited = controller.getEntity(line.id);
  edited.end = [24, 7];
  const result = controller.updateEntities([edited], {
    lockedVariableIds: controller.variableIdsForFeature({ kind: 'point', recordId: line.id, index: 2 }),
  });
  assert.ok(['converged', 'unchanged'].includes(result.result.status), result.result.message);
  const solved = controller.getEntity(line.id);
  near(Math.hypot(solved.end[0] - solved.start[0], solved.end[1] - solved.start[1]), 10, 1e-4);
});

test('Length locks an arc length rather than its radius or sweep independently', () => {
  const controller = createSolverController();
  const arc = controller.addEntity({ id: 'length-arc', type: 'arc', start: [10, 0], arcPoint: [0, 10], end: [-10, 0] });
  const added = controller.addConstraint({ type: 'Length', featureRefs: [{ kind: 'arc', recordId: arc.id }] });
  assert.ok(added.constraint, added.result.message);
  const originalLength = added.constraint.value;
  const edited = controller.getEntity(arc.id);
  edited.end = [-7, 7];
  const result = controller.updateEntities([edited], {
    lockedVariableIds: controller.variableIdsForFeature({ kind: 'point', recordId: arc.id, index: 2 }),
  });
  assert.ok(['converged', 'unchanged'].includes(result.result.status), result.result.message);
  const solved = controller.getEntity(arc.id);
  const startAngle = Math.atan2(solved.start[1] - solved.center[1], solved.start[0] - solved.center[0]);
  const endAngle = Math.atan2(solved.end[1] - solved.center[1], solved.end[0] - solved.center[0]);
  const tau = Math.PI * 2;
  const normalize = (angle) => (angle + tau) % tau;
  const sweep = solved.ccw ? normalize(endAngle - startAngle) : normalize(startAngle - endAngle);
  near(solved.radius * sweep, originalLength, 1e-4);
});

test('fixed variables reject an incompatible constraint without changing geometry', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [20, 10] });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] }).constraint);
  const before = controller.getEntity(line.id);
  const rejected = controller.addConstraint({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  assert.equal(rejected.constraint, null);
  assert.deepEqual(controller.getEntity(line.id), before);
});

test('drag locks hold edited variables while connected geometry solves', () => {
  const controller = createSolverController();
  const first = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 0] });
  const second = controller.addEntity({ id: 'line-b', type: 'line', start: [10, 10], end: [20, 10] });
  const constraint = controller.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: first.id, index: 2 },
      { kind: 'point', recordId: second.id, index: 0 },
    ],
  });
  assert.ok(constraint.constraint);
  const edited = controller.getEntity(first.id);
  edited.end = [30, 40];
  const locked = controller.variableIdsForFeature({ kind: 'point', recordId: first.id, index: 2 });
  const update = controller.updateEntities([edited], { lockedVariableIds: locked });
  assert.ok(['converged', 'unchanged'].includes(update.result.status));
  assert.deepEqual(controller.getEntity(first.id).end, [30, 40]);
  const follower = controller.getEntity(second.id);
  near(follower.start[0], 30);
  near(follower.start[1], 40);
});

test('driving distance uses the central dimension repository', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 0] });
  controller.dimensions.set({ id: 'length', name: 'length', expression: '50 mm' });
  const added = controller.addConstraint({
    type: 'Distance',
    anchors: {
      start: { type: 'segment-start', recordId: line.id, index: 0 },
      end: { type: 'segment-end', recordId: line.id, index: 0 },
    },
    featureRefs: [],
    dimensionRef: 'length',
  });
  assert.ok(added.constraint);
  const solved = controller.getEntity(line.id);
  near(Math.hypot(solved.end[0] - solved.start[0], solved.end[1] - solved.start[1]), 50, 1e-3);
});

test('a driving circle diameter sets the circle radius to half the entered value', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 10 });
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driving',
    center: [0, 0],
    radius: 10,
    measuredValue: 20,
    elbow: [20, -20],
    label: [40, -20],
    anchors: {
      center: { type: 'center', recordId: 'circle-a' },
      radius: { type: 'radius', recordId: 'circle-a' },
    },
  });

  const result = controller.setDimension(dimension.entity.dimensionId, '50 mm');

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  near(controller.getEntity('circle-a').radius, 25, 1e-3);
  assert.equal(controller.constraints()[0].type, 'Diameter');
});

test('new driving dimensions use the dimension solve path before committing', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'dimension-add-line', type: 'line', start: [5000, -1000], end: [5423.261025435335, -1000] });
  const solveSteps = [];
  const solve = controller.solve.bind(controller);
  let forcedStrictFailure = true;
  controller.solve = (options = {}) => {
    if (forcedStrictFailure && options.tolerance === undefined) {
      forcedStrictFailure = false;
      return { status: 'max-iterations', message: 'simulated strict residual floor.' };
    }
    return solve(options);
  };
  const solveDimensionStep = controller.solveDimensionStep.bind(controller);
  controller.solveDimensionStep = (options) => {
    solveSteps.push(options);
    return solveDimensionStep(options);
  };

  const added = controller.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [...line.start],
    end: [...line.end],
    measureStart: [...line.start],
    measureEnd: [...line.end],
    label: [5211, -950],
    text: '',
    anchors: {
      start: { type: 'segment-start', recordId: line.id, index: 0 },
      end: { type: 'segment-end', recordId: line.id, index: 0 },
      measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
      measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
    },
  });

  assert.equal(added.entity.dimensionMode, 'driving');
  assert.equal(solveSteps.length, 1);
  assert.equal(solveSteps[0].seedConstraintIds.length, 1);
  assert.equal(controller.constraints()[0].type, 'Horizontal Distance');
});

test('large driving-dimension edits use automatic continuation through constrained arc geometry', () => {
  const controller = createSolverController();
  controller.loadSketch(largeDimensionContinuationFixture());

  const result = controller.setDimension('d9', '7');

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  assert.ok(result.continuationSteps > 1);
  assert.equal(controller.dimensions.get('d9').expression, '7');
  const moving = controller.getEntity('moving-bottom');
  const top = controller.getEntity('top');
  near(Math.abs(top.end[1] - moving.start[1]), 7 * 25.4, 1e-3);
});

test('failed dimension continuation restores the original expression and geometry atomically', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'fixed-dimension-line', type: 'line', start: [0, 0], end: [254, 0] });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 },
    end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
    measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  const dimension = controller.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [...line.start],
    end: [...line.end],
    measureStart: [...line.start],
    measureEnd: [...line.end],
    label: [127, -20],
    text: '',
    anchors,
  });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] }).constraint);
  const before = controller.getEntity(line.id);
  const beforeExpression = controller.dimensions.get(dimension.entity.dimensionId).expression;

  const result = controller.setDimension(dimension.entity.dimensionId, '1000');

  assert.equal(['converged', 'unchanged'].includes(result.status), false);
  assert.deepEqual(controller.getEntity(line.id), before);
  assert.equal(controller.dimensions.get(dimension.entity.dimensionId).expression, beforeExpression);
});

test('a failed edit names the driving dimensions that close an axis-distance loop', () => {
  const controller = createSolverController();
  const parameters = [
    ['dimension-d3', 'd3', 12.098],
    ['dimension-d27', 'd27', 0.75],
    ['dimension-d28', 'd28', 18.5],
    ['dimension-d29', 'd29', 5.652],
  ].map(([id, name, value], order) => ({
    id,
    name,
    expression: String(value),
    value,
    kind: 'dimension',
    driving: true,
    computed: false,
    enabled: true,
    unit: 'mm',
    error: null,
    order,
  }));
  const pointRef = (recordId) => ({ kind: 'point', recordId, index: 0 });
  const distanceConstraint = (id, dimensionRef, start, end) => ({
    id,
    type: 'Vertical Distance',
    source: 'dimension',
    anchors: { start: pointRef(start), end: pointRef(end) },
    featureRefs: [],
    dimensionRef,
    orientation: 1,
    enabled: true,
  });
  controller.loadSketch({
    drawingUnit: 'mm',
    entities: [
      { id: 'loop-p0', type: 'point', point: [0, 0] },
      { id: 'loop-p1', type: 'point', point: [0, 12.098] },
      { id: 'loop-p2', type: 'point', point: [0, 17.75] },
      { id: 'loop-p3', type: 'point', point: [0, 18.5] },
    ],
    parameters,
    constraints: [
      distanceConstraint('constraint-d3', 'dimension-d3', 'loop-p0', 'loop-p1'),
      distanceConstraint('constraint-d29', 'dimension-d29', 'loop-p1', 'loop-p2'),
      distanceConstraint('constraint-d27', 'dimension-d27', 'loop-p2', 'loop-p3'),
      distanceConstraint('constraint-d28', 'dimension-d28', 'loop-p0', 'loop-p3'),
    ],
  });

  const result = controller.setDimension('dimension-d29', '7');

  assert.equal(result.conflictType, 'driving-dimension-loop');
  assert.match(result.message, /d29 cannot use "7"/);
  assert.match(result.message, /d3, d27, and d28/);
  assert.match(result.message, /requires d29 = 5\.652/);
  assert.match(result.message, /Make one dimension in this loop driven/);
  assert.equal(controller.dimensions.get('dimension-d29').expression, '5.652');
});

test('dimension dependency state disables and restores its solver constraint', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 10 });
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driving',
    center: [0, 0],
    radius: 10,
    measuredValue: 20,
    elbow: [20, -20],
    label: [40, -20],
    anchors: {
      center: { type: 'center', recordId: 'circle-a' },
      radius: { type: 'radius', recordId: 'circle-a' },
    },
  });
  const dimensionId = dimension.entity.dimensionId;

  const disabled = controller.setDimensionEnabledStates([[dimensionId, false]]);
  assert.equal(disabled.changed, true);
  assert.equal(controller.dimensions.get(dimensionId).enabled, false);
  assert.equal(controller.constraints()[0].enabled, false);
  controller.updateDimensionAnnotation(dimensionId, dimension.entity);
  assert.equal(
    controller.setDimensionEnabledStates([[dimensionId, false]]).changed,
    false,
  );

  const restored = controller.setDimensionEnabledStates([[dimensionId, true]]);
  assert.equal(restored.changed, true);
  assert.equal(controller.dimensions.get(dimensionId).enabled, true);
  assert.equal(controller.constraints()[0].enabled, true);
});

test('driving arc radius can grow very large while endpoints remain fixed', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'arc-a', type: 'arc', start: [-50, 0], arcPoint: [0, -20], end: [50, 0] });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [{ kind: 'point', recordId: 'arc-a', index: 0 }] }).constraint);
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [{ kind: 'point', recordId: 'arc-a', index: 2 }] }).constraint);
  const feature = controller.model.resolveEntity({ recordId: 'arc-a' });
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    dimensionMode: 'driving',
    center: feature.center,
    radius: feature.radius,
    elbow: [0, -60],
    label: [40, -60],
    text: '',
    anchors: {
      center: { type: 'center', recordId: 'arc-a' },
      radius: { type: 'radius', recordId: 'arc-a' },
    },
  });

  const result = controller.setDimension(dimension.entity.dimensionId, '1000000000 mm');
  const solved = controller.getEntity('arc-a');

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  near(solved.radius, 1_000_000_000, 1e-2);
  assert.deepEqual(solved.start, [-50, 0]);
  assert.deepEqual(solved.end, [50, 0]);
});

test('a driving arc radius can equal exactly half its fixed chord', () => {
  const controller = createSolverController();
  controller.addEntity({
    id: 'semicircle-arc',
    type: 'arc',
    start: [-50, 0],
    arcPoint: [0, -24.031242374328485],
    end: [50, 0],
    center: [0, 40],
    radius: Math.hypot(50, 40),
    ccw: false,
  });
  assert.ok(controller.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'semicircle-arc', index: 0 }],
  }).constraint);
  assert.ok(controller.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'semicircle-arc', index: 2 }],
  }).constraint);
  const feature = controller.model.resolveEntity({ recordId: 'semicircle-arc' });
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    dimensionMode: 'driving',
    center: feature.center,
    radius: feature.radius,
    elbow: [0, -60],
    label: [40, -60],
    text: '',
    anchors: {
      center: { type: 'center', recordId: 'semicircle-arc' },
      radius: { type: 'radius', recordId: 'semicircle-arc' },
    },
  });

  const result = controller.setDimension(dimension.entity.dimensionId, '50 mm');
  const solved = controller.getEntity('semicircle-arc');

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  near(solved.radius, 50, 1e-6);
  near(solved.center[0], 0, 1e-6);
  near(solved.center[1], 0, 1e-6);
  assert.deepEqual(solved.start, [-50, 0]);
  assert.deepEqual(solved.end, [50, 0]);

  controller.model.binding('semicircle-arc').variables.get('center.y').value = 1;
  const projected = controller.solve({ fullSolve: true, jacobianMode: 'blocks' });
  assert.ok(['converged', 'unchanged'].includes(projected.status), projected.message);
  assert.equal(projected.jacobianStats.mode, 'dense-reference');
  assert.equal(projected.jacobianStats.fallbackReason, 'half-chord-arc-projection');
});

test('an exact half-chord arc remains solvable when its connected chord is made collinear', () => {
  const controller = createSolverController();
  const chord = controller.addEntity({ id: 'semicircle-chord', type: 'line', start: [-50, 0], end: [50, 0] });
  const arc = controller.addEntity({
    id: 'semicircle',
    type: 'arc',
    start: [-50, 0],
    arcPoint: [0, 50],
    end: [50, 0],
    center: [0, 0.05],
    radius: Math.hypot(50, 0.05),
    ccw: false,
  });
  const follower = controller.addEntity({ id: 'follower-chord', type: 'line', start: [-40, 20], end: [40, 20] });
  const followerArc = controller.addEntity({
    id: 'follower-arc',
    type: 'arc',
    start: [-40, 20],
    arcPoint: [0, 50],
    end: [40, 20],
  });
  for (const line of [chord, follower]) {
    assert.ok(controller.addConstraint({
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }],
    }).constraint);
  }
  for (const [round, line] of [[arc, chord], [followerArc, follower]]) {
    for (const index of [0, 2]) {
      assert.ok(controller.addConstraint({
        type: 'Coincident',
        featureRefs: [
          { kind: 'point', recordId: round.id, index },
          { kind: 'point', recordId: line.id, index },
        ],
      }).constraint);
    }
  }
  controller.dimensions.set({ id: 'chord-length', name: 'chordLength', expression: '100 mm' });
  assert.ok(controller.addConstraint({
    type: 'Distance',
    anchors: {
      start: { type: 'segment-start', recordId: chord.id, index: 0 },
      end: { type: 'segment-end', recordId: chord.id, index: 0 },
    },
    featureRefs: [],
    dimensionRef: 'chord-length',
  }).constraint);
  controller.dimensions.set({ id: 'arc-radius', name: 'arcRadius', expression: 'chordLength/2' });
  assert.ok(controller.addConstraint({
    type: 'Radius',
    featureRefs: [{ kind: 'circle', recordId: arc.id }],
    dimensionRef: 'arc-radius',
  }).constraint);

  const result = controller.addConstraint({
    type: 'Collinear',
    featureRefs: [
      { kind: 'segment', recordId: chord.id, index: 0 },
      { kind: 'segment', recordId: follower.id, index: 0 },
    ],
  });
  const solvedChord = controller.getEntity(chord.id);
  const solvedFollower = controller.getEntity(follower.id);
  const solvedArc = controller.getEntity(arc.id);

  assert.ok(result.constraint, result.result.message);
  assert.ok(['converged', 'unchanged'].includes(result.result.status), result.result.message);
  near(solvedChord.start[1], solvedFollower.start[1], 1e-6);
  near(solvedChord.end[1], solvedFollower.end[1], 1e-6);
  near(Math.hypot(
    solvedChord.end[0] - solvedChord.start[0],
    solvedChord.end[1] - solvedChord.start[1],
  ), 100, 1e-6);
  near(solvedArc.radius, 50, 1e-6);
  near(solvedArc.center[0], (solvedArc.start[0] + solvedArc.end[0]) / 2, 1e-6);
  near(solvedArc.center[1], (solvedArc.start[1] + solvedArc.end[1]) / 2, 1e-6);

  const resized = controller.setDimension('chord-length', '120 mm');
  const resizedChord = controller.getEntity(chord.id);
  const resizedFollower = controller.getEntity(follower.id);
  const resizedArc = controller.getEntity(arc.id);

  assert.ok(['converged', 'unchanged'].includes(resized.status), resized.message);
  near(resizedChord.start[1], resizedFollower.start[1], 1e-6);
  near(Math.hypot(
    resizedChord.end[0] - resizedChord.start[0],
    resizedChord.end[1] - resizedChord.start[1],
  ), 120, 1e-6);
  near(resizedArc.radius, 60, 1e-6);
  near(resizedArc.center[0], (resizedArc.start[0] + resizedArc.end[0]) / 2, 1e-6);
  near(resizedArc.center[1], (resizedArc.start[1] + resizedArc.end[1]) / 2, 1e-6);
});

test('external driving dimensions register editable expressions without solver geometry constraints', () => {
  const controller = createSolverController();
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    dimensionMode: 'driving',
    center: [0, 0],
    radius: 5,
    elbow: [10, 10],
    label: [20, 10],
    anchors: {
      center: { type: 'center', recordId: 'fillet-a' },
      radius: { type: 'radius', recordId: 'fillet-a' },
    },
    externalDrivingTarget: { type: 'fillet-radius', recordId: 'fillet-a' },
  });

  assert.equal(dimension.entity.dimensionMode, 'driving');
  assert.equal(controller.constraints().length, 0);
  const result = controller.setDimension(dimension.entity.dimensionId, '12');
  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  near(controller.dimensions.get(dimension.entity.dimensionId).value, 12 * 25.4);
});

test('fillet radius migration restores a solver constraint before radius edits', () => {
  const controller = createSolverController({ jacobianMode: 'blocks' });
  const first = { id: 'migration-line-a', type: 'line', start: [0, 0], end: [8, 0] };
  const second = { id: 'migration-line-b', type: 'line', start: [10, 2], end: [10, 10] };
  const fillet = {
    id: 'migration-fillet',
    type: 'arc',
    start: [8, 0],
    arcPoint: [9.414213562373096, 0.5857864376269049],
    end: [10, 2],
    center: [8, 2],
    radius: 2,
    ccw: true,
  };
  const constraints = regularFilletConstraints({
    arcId: fillet.id,
    filletArc: fillet,
    firstEntity: first,
    firstRecordId: first.id,
    firstIndex: 2,
    secondEntity: second,
    secondRecordId: second.id,
    secondIndex: 0,
  });
  const batch = controller.applyConstraintBatch({
    entities: [first, second, fillet],
    constraints,
  });
  assert.equal(batch.committed, true, batch.result?.message);
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    dimensionMode: 'driving',
    center: fillet.center,
    radius: fillet.radius,
    elbow: [12, 2],
    label: [14, 2],
    anchors: {
      center: { type: 'center', recordId: fillet.id },
      radius: { type: 'radius', recordId: fillet.id },
    },
    externalDrivingTarget: { type: 'fillet-radius', recordId: fillet.id },
  });
  const dimensionId = dimension.entity.dimensionId;
  const restored = controller.restoreFilletRadiusDimension(dimensionId, fillet.id);
  assert.ok(['converged', 'unchanged'].includes(restored.status), restored.message);
  assert.equal(controller.constraints().filter(({ dimensionRef }) => dimensionRef === dimensionId).length, 1);

  const edited = controller.setDimension(dimensionId, '3');
  assert.ok(['converged', 'unchanged'].includes(edited.status), edited.message);
  const solvedFillet = controller.getEntity(fillet.id);
  const solvedFirst = controller.getEntity(first.id);
  assert.equal(controller.dimensionAnnotations.get(dimensionId).externalDrivingTarget, undefined);
  near(solvedFillet.radius, 3 * 25.4, 1e-6);
  near(Math.hypot(
    solvedFillet.start[0] - solvedFirst.end[0],
    solvedFillet.start[1] - solvedFirst.end[1],
  ), 0, 1e-6);
});

test('arc-heavy dimension edits remain well-conditioned with shallow large-radius arcs', () => {
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const segment = (recordId) => ({ kind: 'segment', recordId, index: 0 });
  const dimension = (id, name, expression, value, order) => ({
    id,
    name,
    type: 'Expression',
    expression,
    value,
    kind: 'dimension',
    driving: true,
    computed: false,
    unit: 'in',
    annotationId: null,
    error: null,
    order,
  });
  const coincident = (first, second) => ({ type: 'Coincident', featureRefs: [first, second] });
  const driving = (id, type, start, end) => ({
    id: `constraint-${id}`,
    type,
    source: 'dimension',
    anchors: { start, end },
    featureRefs: [],
    dimensionRef: id,
  });
  const controller = createSolverController();
  const loaded = controller.loadSketch({
    drawingUnit: 'in',
    entities: [
      { id: 'top', type: 'line', construction: true, start: [-349.38309996220386, -302.25739040445217], end: [412.612853934674, -302.25739014081233] },
      { id: 'right', type: 'line', construction: true, start: [412.6128539727381, -302.257390140596], end: [412.6128539546616, 205.74260958737233] },
      { id: 'bottom', type: 'line', construction: true, start: [412.61285395538135, 205.74260959221013], end: [-349.38309997554006, 205.7426095968316] },
      { id: 'left', type: 'line', construction: true, start: [-349.38309995580113, 205.74260959662004], end: [-349.3830999369198, -302.25739040380796] },
      { id: 'top-arc', type: 'arc', start: [-349.3830999604744, -302.2573902543075], arcPoint: [36.877601600506836, -327.65739081887386], end: [412.6128539013355, -302.25738988351344], center: [31.21164730992925, 2541.8833739307497], radius: 2869.546358503009, ccw: true },
      { id: 'left-arc', type: 'arc', start: [-349.3830999806072, -302.2573902582662], arcPoint: [-374.7830998938789, -52.06480284046954], end: [-349.3830999961393, 205.74260960144832], center: [907.6315030289745, -48.257129861653205], radius: 1282.420255674127, ccw: false },
      { id: 'right-arc', type: 'arc', start: [412.61285390135725, -302.257390134904], arcPoint: [438.0128540284352, -102.3873210923577], end: [412.61285393514464, 205.7426095823182], center: [-786.9958631692148, -48.2512253100278], radius: 1226.2043361841393, ccw: true },
    ],
    parameters: [
      dimension('d1', 'd1', '1 in', 25.4, 0),
      dimension('d2', 'd2', '30 in', 762, 1),
      dimension('d3', 'd3', 'd1', 25.4, 2),
      dimension('d4', 'd4', '20 in', 508, 3),
      dimension('d5', 'd5', 'd1', 25.4, 4),
    ],
    constraints: [
      { type: 'Horizontal', featureRefs: [segment('top')] },
      coincident(point('right', 0), point('top', 2)),
      { type: 'Vertical', featureRefs: [segment('right')] },
      coincident(point('bottom', 0), point('right', 2)),
      { type: 'Horizontal', featureRefs: [segment('bottom')] },
      coincident(point('left', 0), point('bottom', 2)),
      coincident(point('left', 2), point('top', 0)),
      { type: 'Vertical', featureRefs: [segment('left')] },
      coincident(point('top-arc', 0), point('top', 0)),
      coincident(point('top-arc', 2), point('top', 2)),
      driving('d1', 'Vertical Distance', point('top-arc', 1), point('top', 0)),
      driving('d2', 'Distance', { type: 'segment-start', recordId: 'top', index: 0 }, { type: 'segment-end', recordId: 'top', index: 0 }),
      coincident(point('left-arc', 0), point('top-arc', 0)),
      coincident(point('left-arc', 2), point('bottom', 2)),
      driving('d3', 'Horizontal Distance', point('left-arc', 1), point('left', 2)),
      driving('d4', 'Vertical Distance', { type: 'segment-start', recordId: 'left', index: 0 }, { type: 'segment-end', recordId: 'left', index: 0 }),
      coincident(point('right-arc', 0), point('top', 2)),
      coincident(point('right-arc', 2), point('right', 2)),
      driving('d5', 'Horizontal Distance', point('right-arc', 1), point('right', 0)),
    ],
  });

  assert.ok(['converged', 'unchanged'].includes(loaded.status), loaded.message);
  const result = controller.setDimension('d4', '10 in');
  const solvedLeft = controller.getEntity('left');

  assert.equal(result.status, 'converged', result.message);
  assert.ok(result.iterations < 100, `Expected the scaled arc residual to converge efficiently; got ${result.iterations} iterations.`);
  near(Math.abs(solvedLeft.end[1] - solvedLeft.start[1]), 254, 1e-3);
});

test('serialized sketches retain stable entity and constraint references', () => {
  const source = createSolverController();
  const line = source.addEntity({ id: 'stable-line', type: 'line', start: [0, 0], end: [10, 4] });
  assert.ok(source.addConstraint({ id: 'stable-horizontal', type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] }).constraint);
  const snapshot = source.getSketchSnapshot();
  const restored = createSolverController();
  const result = restored.loadSketch(snapshot);
  assert.ok(['converged', 'unchanged'].includes(result.status));
  assert.equal(restored.getEntity('stable-line').id, 'stable-line');
  assert.equal(restored.constraints()[0].id, 'stable-horizontal');
});

test('drawing properties persist and unitless dimension input uses the drawing unit', () => {
  const controller = createSolverController();
  controller.loadSketch({
    drawingUnit: 'in',
    dxfExportUnit: 'cm',
    parameters: [{
      id: 'dimension-width',
      name: 'd1',
      type: 'Expression',
      expression: '1 in',
      value: 25.4,
      kind: 'dimension',
      driving: true,
      computed: false,
      unit: 'in',
      annotationId: null,
      error: null,
      order: 0,
    }],
  });

  assert.ok(['converged', 'unchanged'].includes(controller.setDimension('d1', '2').status));
  near(controller.dimensions.get('d1').value, 50.8);
  assert.equal(controller.dimensions.get('d1').expression, '2');

  controller.createParameter({ name: 'AHeight', expression: '24' });
  assert.ok(['converged', 'unchanged'].includes(controller.setDimension('d1', 'AHeight+10').status));
  near(controller.dimensions.get('d1').value, 34 * 25.4);
  assert.equal(controller.dimensions.get('d1').expression, 'AHeight+10');
  assert.ok(['converged', 'unchanged'].includes(controller.setDimension('d1', '2').status));

  controller.setDrawingProperties({ drawingUnit: 'mm', dxfExportUnit: 'ft', filletRadius: 6 });
  assert.equal(controller.dimensions.get('d1').value, 50.8);
  assert.equal(controller.dimensions.get('d1').unit, 'mm');
  assert.equal(controller.dimensions.get('d1').expression, '50.8');
  assert.equal(controller.getDimensionText('d1', 'value'), '50.8');

  assert.ok(['converged', 'unchanged'].includes(controller.setDimension('d1', '75').status));
  assert.equal(controller.dimensions.get('d1').value, 75);
  assert.equal(controller.dimensions.get('d1').expression, '75');
  assert.deepEqual(
    (({ drawingUnit, dxfExportUnit, filletRadius }) => ({ drawingUnit, dxfExportUnit, filletRadius }))(controller.getSketchSnapshot()),
    { drawingUnit: 'mm', dxfExportUnit: 'ft', filletRadius: 6 },
  );
});

test('legacy drawings without a DXF export unit inherit their drawing unit', () => {
  const controller = createSolverController();
  controller.loadSketch({ drawingUnit: 'cm', entities: [] });
  assert.equal(controller.getSketchSnapshot().dxfExportUnit, 'cm');
});

test('drawing properties default the fillet radius to one drawing unit and persist it', () => {
  const source = createSolverController();
  assert.equal(source.getSketchSnapshot().filletRadius, 25.4);
  source.setDrawingProperties({ drawingUnit: 'cm', filletRadius: 2.5 });
  assert.equal(source.getSketchSnapshot().filletRadius, 25);

  const restored = createSolverController();
  restored.loadSketch(source.getSketchSnapshot());
  assert.equal(restored.drawingUnit, 'cm');
  assert.equal(restored.filletRadius, 25);
});

test('driven rendered measurements persist for multi-curve-length dimensions', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'mcl-line', type: 'line', start: [0, 0], end: [100, 0] });
  const added = controller.addDimension({
    type: 'multi-curve-length-dimension',
    dimensionMode: 'driven',
    target: [50, 0],
    elbow: [120, -20],
    label: [120, -20],
    text: '3.937',
    measuredValue: 100,
    useRenderedMeasurement: true,
    anchors: {
      features: [{ kind: 'segment', recordId: line.id, index: 0 }],
    },
  });

  assert.equal(controller.dimensions.get(added.entity.dimensionId).value, 100);
  controller.dimensions.evaluateAll({ strict: false });
  assert.equal(controller.dimensions.get(added.entity.dimensionId).value, 100);

  controller.updateDimensionAnnotation(added.entity.dimensionId, {
    ...added.entity,
    measuredValue: 120,
    useRenderedMeasurement: true,
  });
  controller.dimensions.evaluateAll({ strict: false });
  assert.equal(controller.dimensions.get(added.entity.dimensionId).value, 120);
  assert.match(controller.getDimensionText(added.entity.dimensionId, 'value'), /^PERIM /);
});

test('redundant constraints remain stable', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 3] });
  assert.ok(controller.addConstraint({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] }).constraint);
  const redundant = controller.addConstraint({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  assert.ok(redundant.constraint);
  near(controller.getEntity(line.id).start[1], controller.getEntity(line.id).end[1]);
});

test('fixed geometry cannot be moved by an edit transaction', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 0] });
  controller.addConstraint({ type: 'Fixed', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  controller.updateEntities([{ ...controller.getEntity(line.id), start: [100, 100], end: [110, 100] }]);
  assert.deepEqual(controller.getEntity(line.id).start, [0, 0]);
  assert.deepEqual(controller.getEntity(line.id).end, [10, 0]);
});

test('fixing a line midpoint locks only the midpoint and allows its length to change', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'midpoint-fixed-line', type: 'line', start: [-5, 0], end: [5, 0] });
  assert.ok(controller.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: line.id, index: 1 }],
  }).constraint);
  assert.ok(controller.addConstraint({
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }],
  }).constraint);
  const dimension = controller.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'aligned',
    start: [-5, 0],
    end: [5, 0],
    measureStart: [-5, 0],
    measureEnd: [5, 0],
    label: [0, -5],
    text: '',
    anchors: {
      start: { type: 'segment-start', recordId: line.id, index: 0 },
      end: { type: 'segment-end', recordId: line.id, index: 0 },
      measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
      measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
    },
  });

  const result = controller.setDimension(dimension.entity.dimensionId, '20 mm');
  const solved = controller.getEntity(line.id);
  const solvedMidpoint = [(solved.start[0] + solved.end[0]) / 2, (solved.start[1] + solved.end[1]) / 2];

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  near(Math.hypot(solved.end[0] - solved.start[0], solved.end[1] - solved.start[1]), 20, 1e-3);
  near(solvedMidpoint[0], 0, 1e-6);
  near(solvedMidpoint[1], 0, 1e-6);
});
