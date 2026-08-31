import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { DimensionRepository, evaluateConstraint } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { SketchModel, circleFromThreePoints } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { evaluateFillet } from '../../packages/paramagic-core/src/modules/FilletSystem.js';

const nearZero = (values, tolerance = 1e-8) => values.forEach((value) => assert.ok(Math.abs(value) <= tolerance, `Expected near-zero residual, got ${value}`));
const point = (recordId, index) => ({ kind: 'point', recordId, index });
const segment = (recordId, index = 0) => ({ kind: 'segment', recordId, index });
const arc = (recordId) => ({ kind: 'arc', recordId });
const circle = (recordId) => ({ kind: 'circle', recordId });
const measuredArcLength = (entity) => {
  const tau = Math.PI * 2;
  const normalize = (angle) => (angle + tau) % tau;
  const startAngle = Math.atan2(entity.start[1] - entity.center[1], entity.start[0] - entity.center[0]);
  const endAngle = Math.atan2(entity.end[1] - entity.center[1], entity.end[0] - entity.center[0]);
  const sweep = entity.ccw ? normalize(endAngle - startAngle) : normalize(startAngle - endAngle);
  return entity.radius * sweep;
};
const signedTangentRatio = (line, round, referencePoint = line.start) => {
  const direction = [line.end[0] - line.start[0], line.end[1] - line.start[1]];
  const centerOffset = [round.center[0] - referencePoint[0], round.center[1] - referencePoint[1]];
  return (
    direction[0] * centerOffset[1] - direction[1] * centerOffset[0]
  ) / (Math.hypot(...direction) * Math.abs(round.radius));
};

function fixture() {
  const model = new SketchModel();
  model.addEntity({ id: 'horizontal', type: 'line', start: [0, 0], end: [10, 0] });
  model.addEntity({ id: 'vertical', type: 'line', start: [0, 0], end: [0, 10] });
  model.addEntity({ id: 'parallel', type: 'line', start: [2, 5], end: [12, 5] });
  model.addEntity({ id: 'point-line', type: 'line', start: [5, 0], end: [5, 4] });
  model.addEntity({ id: 'text-anchor', type: 'text', x: 5, y: 0, text: 'Label', fontName: 'Arial', fontSize: 28 });
  model.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 5 });
  model.addEntity({ id: 'circle-b', type: 'circle', center: [0, 0], radius: 8 });
  model.addEntity({ id: 'circle-c', type: 'circle', center: [20, 0], radius: 5 });
  model.addEntity({ id: 'arc-a', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'arc-b', type: 'arc', start: [15, 0], arcPoint: [10, 5], end: [5, 0] });
  model.addEntity({ id: 'arc-quarter', type: 'arc', start: [20, 0], arcPoint: [10 + 10 * Math.SQRT1_2, 10 * Math.SQRT1_2], end: [10, 10] });
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
    { type: 'Point-on Line', featureRefs: [point('text-anchor', 0), segment('horizontal')] },
    { type: 'Collinear', featureRefs: [segment('horizontal'), segment('parallel')] , expectNonZero: true },
    { type: 'Equal', featureRefs: [segment('horizontal'), segment('parallel')] },
    { type: 'Equal', featureRefs: [circle('circle-a'), circle('circle-c')] },
    { type: 'Equal', featureRefs: [arc('arc-a'), arc('arc-b')] },
    { type: 'Equal', featureRefs: [arc('arc-a'), arc('arc-quarter')] },
    { type: 'Length', featureRefs: [segment('horizontal')], value: 10 },
    { type: 'Length', featureRefs: [arc('arc-a')], value: Math.PI * 5 },
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

test('Equal rejects mixed geometry categories', () => {
  const { model, dimensions } = fixture();
  assert.throws(
    () => evaluateConstraint(model, { type: 'Equal', featureRefs: [arc('arc-a'), circle('circle-a')] }, dimensions),
    /two segments, two arcs, or two circles/i,
  );
});

test('Length rejects circles and curves', () => {
  const { model, dimensions } = fixture();
  model.addEntity({ id: 'curve-a', type: 'curve', points: [[0, 0], [4, 2], [8, 0]] });
  const registry = new ConstraintRegistry();
  assert.throws(
    () => registry.validate(model, { type: 'Length', featureRefs: [circle('circle-a')], value: 10 }, dimensions),
    /one line segment or arc/i,
  );
  assert.throws(
    () => registry.validate(model, { type: 'Length', featureRefs: [{ kind: 'curve', recordId: 'curve-a' }], value: 10 }, dimensions),
    /one line segment or arc/i,
  );
});

test('solver applies Equal to circle circumferences', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'circle-driver', type: 'circle', center: [0, 0], radius: 5 });
  controller.addEntity({ id: 'circle-follower', type: 'circle', center: [20, 0], radius: 8 });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [circle('circle-driver')] }).constraint);

  const outcome = controller.addConstraint({
    type: 'Equal',
    featureRefs: [circle('circle-driver'), circle('circle-follower')],
  });

  assert.ok(outcome.constraint, outcome.result.message);
  assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');
  assert.ok(Math.abs(controller.getEntity('circle-driver').radius - controller.getEntity('circle-follower').radius) < 1e-4);
});

test('solver applies Equal to arc lengths with different sweep angles', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'arc-driver', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  controller.addEntity({
    id: 'arc-follower',
    type: 'arc',
    start: [28, 0],
    arcPoint: [20 + 8 * Math.SQRT1_2, 8 * Math.SQRT1_2],
    end: [20, 8],
  });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [arc('arc-driver')] }).constraint);

  const outcome = controller.addConstraint({
    type: 'Equal',
    featureRefs: [arc('arc-driver'), arc('arc-follower')],
  });

  assert.ok(outcome.constraint, outcome.result.message);
  assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');
  const driverLength = measuredArcLength(controller.getEntity('arc-driver'));
  const followerLength = measuredArcLength(controller.getEntity('arc-follower'));
  assert.ok(Math.abs(driverLength - followerLength) < 1e-4, `${driverLength} did not equal ${followerLength}`);
});

test('solver convergence keeps collinear segments on one geometric line', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'collinear-driver', type: 'line', start: [0, 0], end: [100, 0] });
  controller.addEntity({ id: 'collinear-follower', type: 'line', start: [20, 10], end: [80, 10] });

  const outcome = controller.addConstraint({
    type: 'Collinear',
    featureRefs: [segment('collinear-driver'), segment('collinear-follower')],
  });
  assert.ok(outcome.constraint, outcome.result.message);
  assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');

  const driver = controller.getEntity('collinear-driver');
  const follower = controller.getEntity('collinear-follower');
  const direction = [driver.end[0] - driver.start[0], driver.end[1] - driver.start[1]];
  const driverLength = Math.hypot(...direction);
  const distanceFromDriver = (pointValue) => Math.abs(
    (pointValue[0] - driver.start[0]) * direction[1]
    - (pointValue[1] - driver.start[1]) * direction[0]
  ) / driverLength;

  assert.ok(distanceFromDriver(follower.start) <= 1e-8);
  assert.ok(distanceFromDriver(follower.end) <= 1e-8);
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
    assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');
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
    const drawnCcw = controller.getEntity('arc').ccw;
    controller.addEntity({ id: 'line', type: 'line', start: [-8, 8], end: [8, 8] });
    const refs = [{ kind: 'segment', recordId: 'line' }, { kind: 'arc', recordId: 'arc' }];
    const outcome = controller.addConstraint({ type: 'Tangent', featureRefs: reverse ? refs.reverse() : refs });
    assert.ok(outcome.constraint, outcome.result.message);
    assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');
    assert.equal(outcome.constraint.tangentPoint, undefined);
    assert.equal(outcome.constraint.tangentOrientation, -1);
    const arc = controller.getEntity('arc');
    const line = controller.getEntity('line');
    const circle = circleFromThreePoints(arc.start, arc.arcPoint, arc.end);
    assert.ok(Math.abs(signedTangentRatio(line, circle) - outcome.constraint.tangentOrientation) < 1e-4);
    assert.equal(arc.ccw, drawnCcw);
  };
  solveOrder(false);
  solveOrder(true);
});

test('a line tangent at a coincident arc endpoint uses an endpoint-aware residual', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line', type: 'line', start: [0, 0], end: [584.2, 0] });
  const arc = controller.addEntity({
    id: 'arc',
    type: 'arc',
    start: [0, 0],
    arcPoint: [-47.311312, 11.177722],
    end: [-76.2, 31.75],
    center: [0.873154, 109.410568],
    radius: 109.414053,
    ccw: false,
  });
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [segment(line.id)] }).constraint);
  assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [point(arc.id, 2)] }).constraint);
  assert.ok(controller.addConstraint({
    type: 'Coincident',
    featureRefs: [point(arc.id, 0), point(line.id, 0)],
  }).constraint);

  const outcome = controller.addConstraint({
    type: 'Tangent',
    featureRefs: [segment(line.id), { kind: 'arc', recordId: arc.id }],
  });

  assert.ok(outcome.constraint, outcome.result.message);
  assert.equal(controller.solve({ fullSolve: true, tolerance: 1e-8 }).status, 'converged');
  assert.deepEqual(outcome.constraint.tangentPoint, { kind: 'point', recordId: arc.id, index: 0 });
  assert.equal(outcome.constraint.tangentOrientation, 1);
  assert.ok(outcome.result.iterations < 50);
  const solvedArc = controller.getEntity(arc.id);
  const solvedLine = controller.getEntity(line.id);
  const lineDirection = [
    solvedLine.end[0] - solvedLine.start[0],
    solvedLine.end[1] - solvedLine.start[1],
  ];
  const radial = [
    solvedArc.center[0] - solvedArc.start[0],
    solvedArc.center[1] - solvedArc.start[1],
  ];
  assert.ok(Math.abs(lineDirection[0] * radial[0] + lineDirection[1] * radial[1]) < 1e-4);
  assert.ok(Math.abs(
    signedTangentRatio(solvedLine, solvedArc, solvedArc.start) - outcome.constraint.tangentOrientation
  ) < 1e-4);
  assert.equal(solvedArc.ccw, false);
});

test('a tangent orientation rejects the mirrored line-to-arc branch', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'line', type: 'line', start: [-10, 0], end: [10, 0] });
  model.addEntity({
    id: 'arc-above',
    type: 'arc',
    start: [0, 0],
    arcPoint: [5, 5],
    end: [0, 10],
    center: [0, 5],
    radius: 5,
  });
  model.addEntity({
    id: 'arc-below',
    type: 'arc',
    start: [0, 0],
    arcPoint: [5, -5],
    end: [0, -10],
    center: [0, -5],
    radius: 5,
  });
  const dimensions = new DimensionRepository();
  const tangent = (recordId) => ({
    type: 'Tangent',
    featureRefs: [segment('line'), arc(recordId)],
    tangentPoint: point(recordId, 0),
    tangentOrientation: 1,
  });

  nearZero(evaluateConstraint(model, tangent('arc-above'), dimensions));
  assert.ok(evaluateConstraint(model, tangent('arc-below'), dimensions).some((value) => Math.abs(value) > 0.5));
});

test('loading a legacy tangent records its existing branch orientation', () => {
  const controller = createSolverController();
  controller.loadSketch({
    entities: [
      { id: 'line', type: 'line', start: [-10, 0], end: [10, 0] },
      {
        id: 'arc',
        type: 'arc',
        start: [0, 0],
        arcPoint: [5, 5],
        end: [0, 10],
        center: [0, 5],
        radius: 5,
      },
    ],
    constraints: [{
      id: 'legacy-tangent',
      type: 'Tangent',
      featureRefs: [segment('line'), arc('arc')],
    }],
  });

  const tangent = controller.constraints().find(({ id }) => id === 'legacy-tangent');
  assert.equal(tangent.tangentOrientation, 1);
  assert.deepEqual(tangent.tangentPoint, point('arc', 0));
});

test('Point-on Fillet constrains a live point to the derived fillet arc', () => {
  const controller = createSolverController();
  const horizontal = controller.addEntity({ id: 'horizontal-fillet-source', type: 'line', start: [0, 0], end: [100, 0] });
  const vertical = controller.addEntity({ id: 'vertical-fillet-source', type: 'line', start: [0, 0], end: [0, 100] });
  const fillet = {
    id: 'derived-fillet',
    type: 'fillet',
    sourceA: { recordId: horizontal.id, index: 0 },
    sourceB: { recordId: vertical.id, index: 0 },
    radius: 10,
  };
  controller.setDerivedEntity(fillet);
  const initialArc = evaluateFillet(fillet, new Map([
    [horizontal.id, controller.getEntity(horizontal.id)],
    [vertical.id, controller.getEntity(vertical.id)],
  ])).arc;
  const radial = [
    initialArc.arcPoint[0] - initialArc.center[0],
    initialArc.arcPoint[1] - initialArc.center[1],
  ];
  const marker = controller.addEntity({
    id: 'fillet-point',
    type: 'line',
    start: [initialArc.center[0] + radial[0] * 2, initialArc.center[1] + radial[1] * 2],
    end: [40, 40],
  });
  controller.addConstraint({ type: 'Fixed', featureRefs: [segment(horizontal.id)] });
  controller.addConstraint({ type: 'Fixed', featureRefs: [segment(vertical.id)] });

  const outcome = controller.addConstraint({
    type: 'Point-on Fillet',
    featureRefs: [point(marker.id, 0), { kind: 'arc', recordId: fillet.id }],
  });

  assert.ok(outcome.constraint, outcome.result.message);
  const solvedPoint = controller.getEntity(marker.id).start;
  const solvedArc = evaluateFillet(fillet, new Map([
    [horizontal.id, controller.getEntity(horizontal.id)],
    [vertical.id, controller.getEntity(vertical.id)],
  ])).arc;
  const radiusError = Math.abs(Math.hypot(
    solvedPoint[0] - solvedArc.center[0],
    solvedPoint[1] - solvedArc.center[1],
  ) - solvedArc.radius);
  assert.ok(radiusError < 1e-4, `Point remained ${radiusError} away from the fillet arc.`);
});

test('Point-on Fillet constraints restore with their derived fillet definition', () => {
  const controller = createSolverController();
  controller.loadSketch({
    entities: [
      { id: 'source-a', type: 'line', start: [0, 0], end: [100, 0] },
      { id: 'source-b', type: 'line', start: [0, 0], end: [0, 100] },
      { id: 'point-source', type: 'line', start: [10 - Math.SQRT1_2 * 10, 10 - Math.SQRT1_2 * 10], end: [30, 30] },
    ],
    derivedEntities: [{
      id: 'stored-fillet',
      type: 'fillet',
      sourceA: { recordId: 'source-a', index: 0 },
      sourceB: { recordId: 'source-b', index: 0 },
      radius: 10,
    }],
    constraints: [{
      id: 'stored-point-on-fillet',
      type: 'Point-on Fillet',
      featureRefs: [point('point-source', 0), { kind: 'arc', recordId: 'stored-fillet' }],
    }],
  });

  assert.equal(controller.constraints().some(({ type }) => type === 'Point-on Fillet'), true);
  assert.equal(controller.model.derivedEntity('stored-fillet')?.radius, 10);
});

test('dimension residuals support aligned, axis, radius, and angle targets', () => {
  const { model, dimensions } = fixture();
  dimensions.set({ id: 'ten', name: 'd1', expression: '10' });
  dimensions.set({ id: 'five', name: 'd2', expression: '5' });
  dimensions.set({ id: 'ninety', name: 'd3', expression: '90' });
  nearZero(evaluateConstraint(model, { id: 'distance', type: 'Distance', anchors: { start: { type: 'segment-start', recordId: 'horizontal' }, end: { type: 'segment-end', recordId: 'horizontal' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'horizontal-distance', type: 'Horizontal Distance', anchors: { start: { type: 'segment-start', recordId: 'horizontal' }, end: { type: 'segment-end', recordId: 'horizontal' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'vertical-distance', type: 'Vertical Distance', anchors: { start: { type: 'segment-start', recordId: 'vertical' }, end: { type: 'segment-end', recordId: 'vertical' } }, featureRefs: [], dimensionRef: 'ten' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'radius', type: 'Radius', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }], dimensionRef: 'five' }, dimensions));
  nearZero(evaluateConstraint(model, { id: 'angle', type: 'Angle', featureRefs: [segment('horizontal'), segment('vertical')], dimensionRef: 'ninety' }, dimensions));
  nearZero(evaluateConstraint(model, {
    id: 'opposite-ray-angle',
    type: 'Angle',
    featureRefs: [segment('horizontal'), segment('vertical')],
    firstRaySign: -1,
    secondRaySign: 1,
    angleOrientation: -1,
    dimensionRef: 'ninety',
  }, dimensions));
  nearZero(evaluateConstraint(model, {
    id: 'meta',
    type: 'Meta',
    parameterRef: model.binding('circle-a').variables.get('radius').id,
    dimensionRef: 'five',
  }, dimensions));
});

test('aligned distance direction residuals reject mirrored point and point-to-line branches', () => {
  const { model, dimensions } = fixture();
  dimensions.set({ id: 'ten', name: 'd1', expression: '10' });
  model.addEntity({ id: 'mirrored-point', type: 'line', start: [-10, 0], end: [-20, 0] });
  model.addEntity({ id: 'reference-line', type: 'line', start: [-20, 0], end: [20, 0] });
  model.addEntity({ id: 'mirrored-above', type: 'line', start: [0, -10], end: [5, -10] });

  const distanceResiduals = evaluateConstraint(model, {
    id: 'directed-distance',
    type: 'Distance',
    anchors: { start: point('horizontal', 0), end: point('mirrored-point', 0) },
    direction: [1, 0],
    dimensionRef: 'ten',
  }, dimensions);
  const pointLineResiduals = evaluateConstraint(model, {
    id: 'directed-point-line',
    type: 'Point Line Distance',
    subtype: 'aligned',
    featureRefs: [point('mirrored-above', 0), segment('reference-line')],
    direction: [0, 1],
    dimensionRef: 'ten',
  }, dimensions);

  assert.equal(distanceResiduals[0], 0);
  assert.equal(distanceResiduals[1], -1);
  assert.equal(pointLineResiduals[0], 0);
  assert.equal(pointLineResiduals[1], -1);
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

test('loading a drawing preserves invalid constraints as disabled warnings', () => {
  const controller = createSolverController();
  const result = controller.loadSketch({
    entities: [{ id: 'loaded-zero-line', type: 'line', start: [1, 1], end: [1, 1] }],
    constraints: [{
      id: 'loaded-invalid-horizontal',
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: 'loaded-zero-line', index: 0 }],
    }],
  });
  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  assert.equal(result.loadWarnings.length, 1);
  assert.match(result.loadWarnings[0].message, /non-degenerate/i);
  assert.equal(controller.getEntity('loaded-zero-line').id, 'loaded-zero-line');
  assert.equal(controller.constraints()[0].enabled, false);
  assert.match(controller.constraints()[0].loadError, /non-degenerate/i);
});
