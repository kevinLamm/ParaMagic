import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintRegistry } from '../modules/solver/ConstraintRegistry.js';
import { DimensionRepository } from '../modules/solver/DimensionRepository.js';
import { SketchModel } from '../modules/solver/SketchModel.js';
import { evaluateConstraint } from '../modules/solver/residuals.js';
import { createSolverController } from '../modules/solver/SolverController.js';
import { circleFromThreePoints } from '../modules/solver/GeometryBindings.js';

const nearZero = (values, tolerance = 1e-8) => values.forEach((value) => assert.ok(Math.abs(value) <= tolerance, `Expected near-zero residual, got ${value}`));
const point = (recordId, index) => ({ kind: 'point', recordId, index });
const segment = (recordId, index = 0) => ({ kind: 'segment', recordId, index });

function fixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'horizontal', type: 'line', start: [0, 0], end: [10, 0] });
  model.addEntity({ id: 'vertical', type: 'line', start: [0, 0], end: [0, 10] });
  model.addEntity({ id: 'parallel', type: 'line', start: [2, 5], end: [12, 5] });
  model.addEntity({ id: 'point-line', type: 'line', start: [5, 0], end: [5, 4] });
  model.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 5 });
  model.addEntity({ id: 'circle-b', type: 'circle', center: [0, 0], radius: 8 });
  model.addEntity({ id: 'arc-a', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'arc-b', type: 'arc', start: [15, 0], arcPoint: [10, 5], end: [5, 0] });
  model.addEntity({ id: 'arc-internal', type: 'arc', start: [5, 0], arcPoint: [3, 2], end: [1, 0] });
  return { model, dimensions: new DimensionRepository() };
}

test('residual dictionary reports zero for satisfied geometric constraints', () => {
  const { model, dimensions } = fixture();
  const cases = [
    { type: 'Coincident', featureRefs: [point('horizontal', 0), point('vertical', 0)] },
    { type: 'Horizontal', featureRefs: [segment('horizontal')] },
    { type: 'Vertical', featureRefs: [segment('vertical')] },
    { type: 'Parallel', featureRefs: [segment('horizontal'), segment('parallel')] },
    { type: 'Perpendicular', featureRefs: [segment('horizontal'), segment('vertical')] },
    { type: 'Point-on Line', featureRefs: [point('point-line', 0), segment('horizontal')] },
    { type: 'Collinear', featureRefs: [segment('horizontal'), segment('parallel')] , expectNonZero: true },
    { type: 'Equal', featureRefs: [segment('horizontal'), segment('parallel')] },
    { type: 'Midpoint', featureRefs: [point('point-line', 0), segment('horizontal')] },
    { type: 'Concentric', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'circle', recordId: 'circle-b' }] },
    { type: 'Concentric', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'arc', recordId: 'arc-a' }] },
    { type: 'Tangent', featureRefs: [segment('parallel'), { kind: 'circle', recordId: 'circle-a' }] },
    { type: 'Tangent', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, segment('parallel')] },
    { type: 'Tangent', featureRefs: [{ kind: 'arc', recordId: 'arc-a' }, { kind: 'arc', recordId: 'arc-b' }], tangentMode: 'external' },
    { type: 'Tangent', featureRefs: [{ kind: 'arc', recordId: 'arc-b' }, { kind: 'arc', recordId: 'arc-a' }], tangentMode: 'external' },
    { type: 'Tangent', featureRefs: [{ kind: 'arc', recordId: 'arc-a' }, { kind: 'arc', recordId: 'arc-internal' }], tangentMode: 'internal' },
    { type: 'Point-on Circle', featureRefs: [point('point-line', 0), { kind: 'circle', recordId: 'circle-a' }] },
    { type: 'Point-on Arc', featureRefs: [point('point-line', 0), { kind: 'arc', recordId: 'arc-a' }] },
  ];
  cases.forEach((constraint, index) => {
    const values = evaluateConstraint(model, { id: `case-${index}`, ...constraint }, dimensions);
    if (constraint.expectNonZero) assert.ok(values.some((value) => Math.abs(value) > 1e-6));
    else nearZero(values);
  });
});

test('solver applies arc-to-arc tangency in either selection order', () => {
  const solveOrder = (reverse = false) => {
    const controller = createSolverController();
    controller.addEntity({ id: 'arc-left', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
    controller.addEntity({ id: 'arc-right', type: 'arc', start: [17, 0], arcPoint: [12, 5], end: [7, 0] });
    const refs = [{ kind: 'arc', recordId: 'arc-left' }, { kind: 'arc', recordId: 'arc-right' }];
    const outcome = controller.addConstraint({
      type: 'Tangent',
      featureRefs: reverse ? refs.reverse() : refs,
      tangentMode: 'external',
    });
    assert.ok(outcome.constraint, outcome.result.message);
    const left = controller.getEntity('arc-left');
    const right = controller.getEntity('arc-right');
    const leftCircle = circleFromThreePoints(left.start, left.arcPoint, left.end);
    const rightCircle = circleFromThreePoints(right.start, right.arcPoint, right.end);
    const centerDistance = Math.hypot(
      rightCircle.center[0] - leftCircle.center[0],
      rightCircle.center[1] - leftCircle.center[1],
    );
    assert.ok(Math.abs(centerDistance - leftCircle.radius - rightCircle.radius) < 1e-4);
  };
  solveOrder(false);
  solveOrder(true);
});

test('solver applies line-to-arc tangency in either selection order', () => {
  const solveOrder = (reverse = false) => {
    const controller = createSolverController();
    controller.addEntity({ id: 'arc', type: 'arc', start: [-5, 0], arcPoint: [0, -5], end: [5, 0] });
    controller.addEntity({ id: 'line', type: 'line', start: [-8, 8], end: [8, 8] });
    const refs = [{ kind: 'segment', recordId: 'line' }, { kind: 'arc', recordId: 'arc' }];
    const outcome = controller.addConstraint({ type: 'Tangent', featureRefs: reverse ? refs.reverse() : refs });
    assert.ok(outcome.constraint, outcome.result.message);
    const arc = controller.getEntity('arc');
    const line = controller.getEntity('line');
    const circle = circleFromThreePoints(arc.start, arc.arcPoint, arc.end);
    const direction = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
    const offset = [circle.center[0] - line.start[0], circle.center[1] - line.start[1]];
    const distanceToLine = Math.abs(direction[0] * offset[1] - direction[1] * offset[0]) / Math.hypot(...direction);
    assert.ok(Math.abs(distanceToLine - circle.radius) < 1e-4);
  };
  solveOrder(false);
  solveOrder(true);
});

test('dimension residuals support aligned, axis, radius, and angle targets', () => {
  const { model, dimensions } = fixture();
  dimensions.set({ id: 'ten', name: 'ten', expression: '10' });
  dimensions.set({ id: 'five', name: 'five', expression: '5' });
  dimensions.set({ id: 'ninety', name: 'ninety', expression: '90' });
  nearZero(evaluateConstraint(model, { id: 'distance', type: 'Distance', anchors: { start: { type: 'segment-start', recordId: 'horizontal' }, end: { type: 'segment-end', recordId: 'horizontal' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'horizontal-distance', type: 'Horizontal Distance', anchors: { start: { type: 'segment-start', recordId: 'horizontal' }, end: { type: 'segment-end', recordId: 'horizontal' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'vertical-distance', type: 'Vertical Distance', anchors: { start: { type: 'segment-start', recordId: 'vertical' }, end: { type: 'segment-end', recordId: 'vertical' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'radius', type: 'Radius', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }], dimensionRef: 'five' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'angle', type: 'Angle', featureRefs: [segment('horizontal'), segment('vertical')], dimensionRef: 'ninety' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'meta', type: 'Meta', parameterRef: 'circle-a:radius', dimensionRef: 'five' }, dimensions));
});

test('model prunes constraints that reference deleted entities', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'a', type: 'line', start: [0, 0], end: [1, 0] });
  model.addEntity({ id: 'b', type: 'line', start: [1, 0], end: [2, 0] });
  model.addConstraint({ id: 'join', type: 'Coincident', featureRefs: [point('a', 2), point('b', 0)] });
  model.removeEntity('a');
  assert.equal(model.constraints.size, 0);
});

test('registry identifies unsupported constraint types', () => {
  const registry = new ConstraintRegistry();
  assert.equal(registry.supports('Point-on Ellipse'), false);
  assert.equal(registry.supports('Parallel'), true);
});

test('registry flattening retains equation-to-constraint metadata', () => {
  const { model, dimensions } = fixture();
  model.addConstraint({ id: 'coincident-a', type: 'Coincident', featureRefs: [point('horizontal', 0), point('vertical', 0)] });
  const evaluation = new ConstraintRegistry().evaluate(model, dimensions);
  assert.equal(evaluation.values.length >= 2, true);
  assert.equal(evaluation.equations.filter((equation) => equation.constraintId === 'coincident-a').length, 2);
});

test('solver handles a sketch near 200 active parameters', () => {
  const controller = createSolverController();
  const lines = Array.from({ length: 50 }, (_, index) => controller.addEntity({ id: `line-${index}`, type: 'line', start: [0, index * 3], end: [10, index * 3 + 1] }));
  lines.forEach((line) => {
    const outcome = controller.addConstraint({ type: 'Horizontal', featureRefs: [segment(line.id)] });
    assert.ok(outcome.constraint);
  });
  assert.equal(controller.model.allVariables().length, 200);
  lines.forEach((line) => {
    const entity = controller.getEntity(line.id);
    assert.ok(Math.abs(entity.start[1] - entity.end[1]) < 1e-4);
  });
});

test('invalid arc input is rejected before it reaches the solver', () => {
  const model = new SketchModel();
  assert.throws(() => model.addEntity({ id: 'bad-arc', type: 'arc', start: [0, 0], arcPoint: [1, 0], end: [2, 0] }), /finite circle/i);
});

test('zero-length segments are rejected for segment constraints', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'zero-line', type: 'line', start: [1, 1], end: [1, 1] });
  const outcome = controller.addConstraint({ type: 'Horizontal', featureRefs: [segment(line.id)] });
  assert.equal(outcome.constraint, null);
  assert.match(outcome.result.message, /non-degenerate/i);
});
