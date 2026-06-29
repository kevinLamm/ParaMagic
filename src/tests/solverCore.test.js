import test from 'node:test';
import assert from 'node:assert/strict';
import { DimensionRepository } from '../modules/solver/DimensionRepository.js';
import { createGeometryBinding } from '../modules/solver/GeometryBindings.js';
import { solveLinearSystem } from '../modules/solver/LinearAlgebra.js';
import { multiply, multiplyMatrixVector, transpose } from '../modules/solver/LinearAlgebra.js';
import { computeJacobian } from '../modules/solver/Jacobian.js';
import { Variable } from '../modules/solver/Variable.js';
import { createSolverController } from '../modules/solver/SolverController.js';
import { solveLevenbergMarquardt } from '../modules/solver/LevenbergMarquardt.js';

const near = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);

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

test('LM solver satisfies a horizontal constraint', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [100, 25] });
  const added = controller.addConstraint({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: line.id, index: 0 }] });
  assert.ok(['converged', 'unchanged'].includes(added.result.status));
  assert.ok(added.result.timings.totalMs >= 0);
  const solved = controller.getEntity(line.id);
  near(solved.start[1], solved.end[1]);
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

test('arc-heavy dimension edits can converge beyond the former 100 iteration limit', () => {
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
  assert.ok(result.iterations > 100, `Expected the regression fixture to require more than 100 iterations; got ${result.iterations}.`);
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

  controller.setDrawingProperties({ drawingUnit: 'mm', dxfExportUnit: 'ft' });
  assert.equal(controller.dimensions.get('d1').value, 50.8);
  assert.equal(controller.dimensions.get('d1').unit, 'mm');
  assert.equal(controller.dimensions.get('d1').expression, '50.8');
  assert.equal(controller.getDimensionText('d1', 'value'), '50.8');

  assert.ok(['converged', 'unchanged'].includes(controller.setDimension('d1', '75').status));
  assert.equal(controller.dimensions.get('d1').value, 75);
  assert.equal(controller.dimensions.get('d1').expression, '75');
  assert.deepEqual(
    (({ drawingUnit, dxfExportUnit }) => ({ drawingUnit, dxfExportUnit }))(controller.getSketchSnapshot()),
    { drawingUnit: 'mm', dxfExportUnit: 'ft' },
  );
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
