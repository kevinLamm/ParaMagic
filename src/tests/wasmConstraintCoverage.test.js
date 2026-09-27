import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { DimensionRepository, solveLevenbergMarquardt } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { assembleJacobianBlocks } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { WasmSolverSession, WasmSolverBackend, loadWasmSolverModule } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { evaluateFillet } from '../../packages/paramagic-core/src/modules/FilletSystem.js';
import { deriveSwellGeometry, withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { solveConstraintScope } from '../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';

const module = await loadWasmSolverModule(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const ref = (kind, recordId, index = 0) => ({ kind, recordId, index });
const point = id => ref('point', id), segment = id => ref('segment', id), arc = id => ref('arc', id), circle = id => ref('circle', id);
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
function fixture(type, overrides = {}) {
  const model = new SketchModel(), dimensions = new DimensionRepository(), registry = new ConstraintRegistry();
  for (const entity of [
    { id: 'a', type: 'line', start: [2, 3], end: [8, 9] },
    { id: 'b', type: 'line', start: [1, 6], end: [9, 4] },
    { id: 'p', type: 'point', point: [4, 7] },
    { id: 'c', type: 'circle', center: [1, 3], radius: 3 },
    { id: 'd', type: 'circle', center: [8, 2], radius: 2 },
    { id: 'r', type: 'arc', center: [0, 0], radius: 5, start: [5, 0], arcPoint: [3, 4], end: [0, 5], ccw: true },
    { id: 's', type: 'arc', center: [10, 0], radius: 5, start: [5, 0], arcPoint: [7, 4], end: [10, 5], ccw: false },
  ]) model.addEntity(entity);
  const features = { Parallel: [segment('a'), segment('b')], Perpendicular: [segment('a'), segment('b')],
    'Point-on Line': [point('p'), segment('a')], 'Point Line Distance': [point('p'), segment('a')],
    'Line Line Distance': [segment('a'), segment('b')], Collinear: [segment('a'), segment('b')],
    Equal: [segment('a'), segment('b')], Length: [segment('a')], Tangent: [segment('a'), circle('c')],
    'Point-on Arc': [point('p'), arc('r')], Angle: [segment('a'), segment('b')], Meta: [],
    Radius: [arc('r')], Diameter: [arc('r')], Concentric: [arc('r'), arc('s')],
    Coincident: [ref('point', 'a', 1), { ...ref('point', 'r'), pointRole: 'arc-midpoint' }],
  };
  const parameterRef = model.binding('a').variables.get('end.x').id;
  model.addConstraint({ id: 'test', type, value: 3.7, featureRefs: features[type], parameterRef: type === 'Meta' ? parameterRef : undefined, ...overrides });
  return { model, dimensions, registry };
}
function check(f, { tolerance = 1e-7, analytical = false } = {}) {
  const session = new WasmSolverSession(module); session.prepare(f);
  assert.equal(session.native.linearize(), 1);
  const expected = assembleJacobianBlocks(f.registry.blocks(f.model, f.dimensions));
  const residuals = f.registry.evaluate(f.model, f.dimensions).values;
  const actual = session.view(8, Float64Array, session.rowCount), entries = session.view(7, Float64Array, session.entryCount);
  const offsets = session.view(5, Int32Array, session.rowCount + 1), columns = session.view(6, Int32Array, session.entryCount);
  assert.equal(actual.length, residuals.length);
  residuals.forEach((value, row) => {
    close(actual[row], value, 1e-11);
    const dense = new Float64Array(f.model.activeVariables().length);
    for (let e = offsets[row]; e < offsets[row + 1]; e++) dense[columns[e]] = entries[e];
    expected.matrix[row].forEach((v, col) => close(dense[col], v, tolerance));
  });
  if (analytical) {
    const stats = session.solve({ ...f, maxIterations: 1, solveMode: 'interactive', tolerance: 1e-12 }).jacobianStats;
    assert.equal(stats.fallbackBlocks, 0, `Unexpected numerical derivative fallback: ${JSON.stringify(stats)}`);
  }
  return session;
}
for (const type of ['Parallel', 'Perpendicular', 'Point-on Line', 'Point Line Distance', 'Line Line Distance',
  'Collinear', 'Equal', 'Length', 'Tangent', 'Point-on Arc', 'Angle', 'Meta', 'Radius', 'Diameter', 'Concentric', 'Coincident']) {
  test(`WASM coverage: ${type} residuals and Jacobian match JavaScript`, () => check(fixture(type)));
}
test('WASM preserves analytical line and arc length derivatives', () => {
  for (const type of ['Parallel', 'Perpendicular', 'Point-on Line', 'Line Line Distance', 'Collinear', 'Equal', 'Length', 'Tangent']) check(fixture(type), { analytical: true });
  check(fixture('Length', { featureRefs: [arc('r')] }), { analytical: true });
});
test('WASM equal/length/tangent variants and domain branches match JavaScript', () => {
  for (const refs of [[arc('r'), arc('s')], [circle('c'), circle('d')]]) check(fixture('Equal', { featureRefs: refs }));
  for (const tangentMode of ['internal', 'external']) {
    for (const refs of [[circle('c'), circle('d')], [arc('r'), arc('s')], [arc('r'), circle('d')]]) check(fixture('Tangent', { featureRefs: refs, tangentMode }));
    check(fixture('Tangent', { featureRefs: [arc('r'), arc('s')], tangentMode, tangentPoint: point('r') }));
  }
  for (const tangentOrientation of [-1, 0, 1]) check(fixture('Tangent', { featureRefs: [segment('a'), arc('r')], tangentPoint: point('r'), tangentOrientation }));
  for (const p of [[3, 4], [5, 0], [0, 5], [-3, -4], [0, 0]]) {
    const f = fixture('Point-on Arc'); f.model.updateEntity({ id: 'p', type: 'point', point: p }); check(f);
  }
});
test('WASM projected dimensions preserve clamping, orientation, and degenerate lines', () => {
  for (const projectionMode of ['line', 'segment']) for (const subtype of [undefined, 'horizontal', 'vertical']) {
    for (const p of [[4, 7], [-5, -4], [40, 70], [2, 3], [8, 9]]) {
      const f = fixture('Point Line Distance', { projectionMode, subtype, direction: [-1, 0], orientation: -1 });
      f.model.updateEntity({ id: 'p', type: 'point', point: p });
      try { check(f); } catch (error) { error.message += ` (${projectionMode}, ${subtype}, ${p})`; throw error; }
    }
    const f = fixture('Point Line Distance', { projectionMode, subtype });
    f.model.updateEntity({ id: 'a', type: 'line', start: [2, 3], end: [2, 3] }); check(f);
  }
});
test('WASM supports polygon/table segments, interpolated points, and global frames', () => {
  const f = fixture('Parallel');
  f.model.addEntity({ id: 'poly', type: 'rect', x: 1, y: 2, width: 12, height: 8 });
  f.model.addEntity({ id: 'table', type: 'table', x: 4, y: 6, width: 8, height: 3 });
  f.model.constraints.get('test').featureRefs = [ref('segment', 'poly', 1), ref('segment', 'table', 2)]; check(f);
  f.model.constraints.get('test').type = 'Coincident';
  f.model.constraints.get('test').featureRefs = [{ type: 'segment-point', recordId: 'poly', index: 2, ratio: 0.35 }, ref('point', 'table', 1)]; check(f);
  f.model.constraints.get('test').coordinateSpace = 'global';
  f.model.stackFrame = () => ({ x: 23, y: -4, rotation: 0.6 }); check(f);
});

const arcSource = { id: 'source-a', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737], end: [50, 50], center: [50, 0], radius: 50, ccw: false };
const filletSources = {
  'line-line': [{ id: 'source-a', type: 'line', start: [0, 0], end: [100, 0] }, { id: 'source-b', type: 'line', start: [0, 0], end: [0, 100] }],
  'line-arc': [{ id: 'source-a', type: 'line', start: [0, 0], end: [100, 0] }, { ...arcSource, id: 'source-b' }],
  'curve-line': [{ id: 'source-a', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] }, { id: 'source-b', type: 'line', start: [0, 0], end: [100, 0] }],
  'curve-curve': [{ id: 'source-a', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] }, { id: 'source-b', type: 'curve', points: [[0, 0], [40, 0], [80, 40]] }],
  'arc-arc': [arcSource, { id: 'source-b', type: 'arc', start: [0, 0], arcPoint: [35.35533905932738, 14.64466094067262], end: [50, 50], center: [0, 50], radius: 50, ccw: true }],
};
for (const [name, sources] of Object.entries(filletSources)) test(`WASM Point-on Fillet: ${name}`, () => {
  const model = new SketchModel(), dimensions = new DimensionRepository(), registry = new ConstraintRegistry();
  sources.forEach(e => model.addEntity(e));
  const fillet = { id: 'fillet', type: 'fillet', sourceA: { recordId: 'source-a', index: 0 }, sourceB: { recordId: 'source-b', index: 0 }, radius: 10 };
  model.setDerivedEntity(fillet);
  const evaluated = evaluateFillet(fillet, new Map(sources.map(e => [e.id, model.entity(e.id)])));
  assert.ok(evaluated.valid);
  model.addEntity({ id: 'p', type: 'point', point: evaluated.arc.arcPoint });
  model.addConstraint({ id: 'test', type: 'Point-on Fillet', featureRefs: [point('p'), arc('fillet')] });
  check({ model, dimensions, registry }, { tolerance: 1e-6 });
  const original = model.allVariables().map(v => v.value);
  // Hold sources while the marker follows a changed radius. This is the same
  // mutation the application sends for a dimension-driven derived fillet.
  for (const b of model.entities.values()) if (b.id !== 'p') b.allVariables().forEach(v => { v.locked = true; });
  const session = new WasmSolverSession(module);
  session.prepare({ model, dimensions });
  for (const radius of [10.2, 10.4, 10]) {
    model.setDerivedEntity({ ...fillet, radius });
    const before = model.allVariables().map(v => v.value);
    const options = { model, dimensions, registry, tolerance: 1e-9, jacobianMode: 'blocks' };
    const js = solveLevenbergMarquardt(options), expected = model.allVariables().map(v => v.value);
    model.allVariables().forEach((v, i) => { v.value = before[i]; });
    const native = session.solve(options);
    assert.equal(native.status, js.status);
    assert.ok(['converged', 'unchanged'].includes(native.status));
    assert.equal(session.topologyBuilds, 1);
    model.allVariables().forEach((v, i) => close(v.value, expected[i], 1e-6));
  }
  model.allVariables().forEach((v, i) => { v.value = original[i]; v.locked = false; });
  model.updateEntity({ id: 'p', type: 'point', point: evaluated.arc.start });
  check({ model, dimensions, registry }, { tolerance: 1e-6 });
});

test('complete native solves agree with JavaScript on the new constraint types', () => {
  for (const type of ['Parallel', 'Perpendicular', 'Point-on Line', 'Point Line Distance', 'Line Line Distance',
    'Collinear', 'Equal', 'Length', 'Tangent', 'Point-on Arc', 'Angle', 'Meta']) {
    const f = fixture(type), before = f.model.allVariables().map(v => v.value);
    const options = { ...f, tolerance: 1e-8, maxIterations: 2000, jacobianMode: 'blocks', matrixFreeVariableThreshold: 1 };
    const js = solveLevenbergMarquardt(options), expected = f.model.allVariables().map(v => v.value);
    f.model.allVariables().forEach((v, i) => { v.value = before[i]; });
    const native = new WasmSolverSession(module).solve(options);
    assert.equal(native.status, js.status, `${type}: ${native.status} / ${js.status}`);
    close(native.finalError, js.finalError, 1e-12);
    if (['converged', 'unchanged'].includes(js.status)) {
      assert.ok(Math.hypot(...f.registry.evaluate(f.model, f.dimensions).values) < 1e-8, type);
      // Free models have multiple valid coordinates. Compare trajectories to a
      // loose coordinate bound, with strict residual checks above.
      f.model.allVariables().forEach((v, i) => close(v.value, expected[i], 1e-4));
    }
  }
});

test('native arc radius edits preserve exact semicircle reduction and branch seeding', () => {
  const create = native => {
    const controller = createSolverController({ jacobianMode: 'blocks', numericBackend: native ? new WasmSolverBackend(module) : null });
    controller.addEntity({ id: 'arc', type: 'arc', start: [-50, 0], arcPoint: [0, -24.031242374328485], end: [50, 0], center: [0, 40], radius: Math.hypot(50, 40), ccw: false });
    for (const index of [0, 2]) assert.ok(controller.addConstraint({ type: 'Fixed', featureRefs: [ref('point', 'arc', index)] }).constraint);
    const feature = controller.getEntity('arc');
    const dimension = controller.addDimension({ type: 'radius-dimension', dimensionMode: 'driving', center: feature.center, radius: feature.radius,
      elbow: [0, -60], label: [40, -60], text: '', anchors: { center: { type: 'center', recordId: 'arc' }, radius: { type: 'radius', recordId: 'arc' } } });
    return { controller, id: dimension.entity.dimensionId };
  };
  const js = create(false), native = create(true);
  for (const target of [50, 64, 65, 50, 1000000000]) {
    for (const state of [js, native]) {
      const result = state.controller.setDimension(state.id, `${target} mm`);
      assert.ok(['converged', 'unchanged'].includes(result.status), `${target}: ${result.message}`);
      if (state === native) assert.equal(result.backend, 'wasm');
      const entity = state.controller.getEntity('arc');
      close(entity.radius, target, 1e-5);
      assert.deepEqual(entity.start, [-50, 0]); assert.deepEqual(entity.end, [50, 0]);
    }
    const a = js.controller.getEntity('arc'), b = native.controller.getEntity('arc');
    a.center.forEach((v, i) => close(v, b.center[i], 1e-5));
  }
});

test('derived Swell parameter edits remain in the persistent native solver', () => {
  const source = withSwellDefinition({ id: 'source', type: 'line', start: [0, 0], end: [80, 0] }, { swellEnabled: false, offsetExpression: 'offset' });
  const movable = { id: 'movable', type: 'line', start: [30, 25], end: [55, 25] };
  const piece = deriveSwellGeometry({ entities: [source], evaluateLength: () => 10 }).get(source.id).pieces[0];
  const backend = new WasmSolverBackend(module), controller = createSolverController({ jacobianMode: 'blocks', numericBackend: backend });
  const loaded = controller.loadSketch({ drawingUnit: 'mm', entities: [source, movable],
    parameters: [{ id: 'offset-param', name: 'offset', kind: 'user', expression: '10', value: 10, unit: 'mm' }],
    constraints: [{ id: 'on-line', type: 'Point-on Line', featureRefs: [point('movable'), { kind: 'segment', recordId: 'source', index: 0,
      derivedFeature: { provider: 'swell', segmentIndex: piece.segmentIndex, role: piece.role, ordinal: piece.ordinal } }] }] });
  assert.ok(['converged', 'unchanged'].includes(loaded.status), loaded.message);
  assert.equal(loaded.backend, 'wasm'); assert.equal(backend.fallbackReason, null);
  const updated = controller.updateParameter('offset-param', { expression: '20' });
  assert.equal(updated.result.backend, 'wasm');
  assert.ok(Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values) < 1e-3);
});

test('invalid dimensional inputs cannot become valid native zero-target constraints', () => {
  for (const f of [fixture('Length', { value: 0 }), fixture('Length', { featureRefs: [circle('c')] }), fixture('Point Line Distance', { value: undefined })]) {
    const before = f.model.snapshot();
    const result = solveConstraintScope({ ...f, numericBackend: new WasmSolverBackend(module), jacobianMode: 'blocks' });
    assert.equal(result.status, 'invalid'); assert.deepEqual(f.model.snapshot(), before);
  }
});
